import { githubResponse, RepositoryError } from './repositories.ts'
import { projectIssueDetail } from './issue-detail.ts'
import { defaultStatuses, getIssueStatus } from './issue-status.ts'

/** Search one authorized repository with safely quoted labels and native status constraints. */
export async function readIssueSearch(
  accessToken: string,
  repositoryId: number,
  text: string,
  status: string,
  label: string,
  sort: string,
  page: number,
) {
  const definition = defaultStatuses.find((item) => item.id === status)
  if (
    text.length > 256 ||
    [...text].some(
      (character) =>
        (character.charCodeAt(0) < 32 && !/\s/u.test(character)) ||
        character.charCodeAt(0) === 127,
    ) ||
    (status !== 'all' && !definition) ||
    label.length > 50 ||
    [...label].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    defaultStatuses.some(
      (item) => item.state === 'open' && item.label === label.toLowerCase(),
    ) ||
    !['updated', 'created-desc', 'created-asc'].includes(sort) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 34
  )
    throw new RepositoryError('invalid_search_parameters', 422)

  // Resolve the canonical name by stable ID, also checking current provider access.
  const { data: metadata } = await githubResponse(
    `/repositories/${repositoryId}`,
    accessToken,
  )
  const repository = metadata as Record<string, unknown>
  if (
    repository.id !== repositoryId ||
    typeof repository.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)
  )
    throw new RepositoryError('github_invalid_response', 502)

  // Only the server can add qualifiers. Quotes/backslashes cannot terminate a word.
  const words = text.split(/[\s"\\]+/u).filter(Boolean)
  const qualifiers = [
    `repo:${repository.full_name}`,
    'is:issue',
    'in:title,body,comments',
    ...words.map((word) => `"${word}"`),
  ]
  if (definition?.state === 'open') {
    qualifiers.push('state:open')
    if (definition.id !== 'backlog')
      qualifiers.push(`label:"${definition.label}"`)
    // Backlog permits its explicit label or no mapping; every conflict is excluded.
    for (const other of defaultStatuses) {
      if (other.state === 'open' && other.id !== definition.id)
        qualifiers.push(`-label:"${other.label}"`)
    }
  } else if (definition?.state === 'closed') {
    qualifiers.push(
      'state:closed',
      `reason:${definition.reason === 'not_planned' ? '"not planned"' : definition.reason}`,
    )
  }
  if (label) qualifiers.push(`label:${JSON.stringify(label)}`)
  const parameters = new URLSearchParams({
    q: qualifiers.join(' '),
    sort: sort === 'updated' ? 'updated' : 'created',
    order: sort === 'created-asc' ? 'asc' : 'desc',
    per_page: '30',
    page: String(page),
  })
  let data: unknown
  try {
    data = (await githubResponse(`/search/issues?${parameters}`, accessToken))
      .data
  } catch (error) {
    if (error instanceof RepositoryError && error.status === 422)
      throw new RepositoryError('github_search_rejected', 422)
    throw error
  }
  const search = data as Record<string, unknown> | null
  if (
    !search ||
    Array.isArray(search) ||
    !Number.isSafeInteger(search.total_count) ||
    Number(search.total_count) < 0 ||
    typeof search.incomplete_results !== 'boolean' ||
    !Array.isArray(search.items) ||
    search.items.length > 30
  )
    throw new RepositoryError('github_invalid_response', 502)
  const totalCount = Number(search.total_count)
  if (
    !search.incomplete_results &&
    search.items.length === 0 &&
    (page - 1) * 30 < Math.min(totalCount, 1000)
  )
    throw new RepositoryError('github_invalid_response', 502)
  const issues = search.items.map((record: unknown) => {
    const item = record as Record<string, unknown> | null
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      'pull_request' in item ||
      typeof item.repository_url !== 'string' ||
      item.repository_url.toLowerCase() !==
        `https://api.github.com/repos/${repository.full_name}`.toLowerCase()
    )
      throw new RepositoryError('github_search_mismatch', 502)
    const issue = projectIssueDetail(
      item,
      repository,
      repositoryId,
      Number(item.number),
    )
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0)
      throw new RepositoryError('github_invalid_response', 502)
    // Reject the entire page on index drift; never silently filter a single page.
    if (
      (status !== 'all' && getIssueStatus(issue).status !== status) ||
      (label &&
        !issue.labels.some(
          (item) => item.name.toLowerCase() === label.toLowerCase(),
        ))
    )
      throw new RepositoryError('github_search_stale', 503)
    return issue
  })
  return {
    issues: issues.slice(0, Math.max(0, 1000 - (page - 1) * 30)),
    page,
    perPage: 30,
    totalCount,
    nextPage: page * 30 < Math.min(totalCount, 1000) ? page + 1 : null,
    incompleteResults: search.incomplete_results,
    searchLimited: totalCount > 1000,
  }
}
