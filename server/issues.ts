import { githubResponse, RepositoryError } from './repositories.ts'
import { defaultStatuses } from './issue-status.ts'
import type { ClosedIssueStatus } from './issue-status.ts'

type IssueLabel = { id: number | null; name: string; color: string | null }
type IssueUser = { id: number; login: string }

/** Search each Closed reason independently and reject incomplete or semantically mismatched results. */
export async function readIssues(
  accessToken: string,
  repository: { id: number; full_name: string },
  state: 'open' | 'closed',
  page: number,
  perPage: number,
  category?: ClosedIssueStatus,
) {
  const definition = defaultStatuses.find(
    (status) => status.id === category && status.state === 'closed',
  )
  if (
    (state === 'closed') !== !!category ||
    (category && definition?.state !== 'closed')
  )
    throw new RepositoryError('github_invalid_response', 502)
  const reason = definition?.state === 'closed' ? definition.reason : null
  if (
    reason &&
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)
  )
    throw new RepositoryError('github_invalid_response', 502)
  const path = reason
    ? '/search/issues'
    : `/repositories/${repository.id}/issues`
  const parameters = new URLSearchParams({
    state,
    page: String(page),
    per_page: String(perPage),
    sort: 'updated',
    direction: 'desc',
  })
  if (reason) {
    parameters.delete('state')
    parameters.delete('direction')
    parameters.set('order', 'desc')
    parameters.set(
      'q',
      `repo:${repository.full_name} is:issue state:closed reason:${reason === 'not_planned' ? '"not planned"' : reason}`,
    )
  }
  const { data, link } = await githubResponse(
    `${path}?${parameters}`,
    accessToken,
  )
  let records: unknown = data
  let totalCount = 0
  if (reason) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new RepositoryError('github_invalid_response', 502)
    const search = data as Record<string, unknown>
    if (search.incomplete_results === true)
      throw new RepositoryError('github_search_incomplete', 503)
    if (
      search.incomplete_results !== false ||
      !Number.isSafeInteger(search.total_count) ||
      Number(search.total_count) < 0
    )
      throw new RepositoryError('github_invalid_response', 502)
    totalCount = Number(search.total_count)
    records = search.items
  }
  if (!Array.isArray(records) || records.length > perPage)
    throw new RepositoryError('github_invalid_response', 502)
  const issues = []
  for (const record of records) {
    const item = record as Record<string, unknown>
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new RepositoryError('github_invalid_response', 502)
    }
    if ('pull_request' in item) {
      if (reason) throw new RepositoryError('github_search_mismatch', 502)
      continue
    }
    if (
      reason &&
      (item.state_reason !== reason ||
        typeof item.repository_url !== 'string' ||
        item.repository_url.toLowerCase() !==
          `https://api.github.com/repos/${repository.full_name}`.toLowerCase())
    ) {
      throw new RepositoryError('github_search_mismatch', 502)
    }
    if (
      typeof item.id !== 'number' ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0 ||
      typeof item.number !== 'number' ||
      !Number.isSafeInteger(item.number) ||
      item.number <= 0 ||
      typeof item.title !== 'string' ||
      item.state !== state ||
      typeof item.created_at !== 'string' ||
      !Number.isFinite(Date.parse(item.created_at)) ||
      typeof item.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(item.updated_at)) ||
      !(item.state_reason == null || typeof item.state_reason === 'string') ||
      !(
        item.closed_at === null ||
        (typeof item.closed_at === 'string' &&
          Number.isFinite(Date.parse(item.closed_at)))
      ) ||
      !Array.isArray(item.labels) ||
      !Array.isArray(item.assignees) ||
      typeof item.comments !== 'number' ||
      !Number.isSafeInteger(item.comments) ||
      item.comments < 0
    )
      throw new RepositoryError('github_invalid_response', 502)

    const labels: IssueLabel[] = item.labels.map((label: unknown) => {
      if (typeof label === 'string')
        return { id: null, name: label, color: null }
      if (
        !label ||
        typeof label !== 'object' ||
        !('id' in label) ||
        !Number.isSafeInteger(label.id) ||
        Number(label.id) <= 0 ||
        !('name' in label) ||
        typeof label.name !== 'string' ||
        !('color' in label) ||
        !(
          label.color === null ||
          (typeof label.color === 'string' &&
            /^[a-f0-9]{6}$/i.test(label.color))
        )
      )
        throw new RepositoryError('github_invalid_response', 502)
      return { id: Number(label.id), name: label.name, color: label.color }
    })

    /** Project only the public identity needed for the list. */
    function readUser(user: unknown): IssueUser {
      if (
        !user ||
        typeof user !== 'object' ||
        !('id' in user) ||
        !Number.isSafeInteger(user.id) ||
        Number(user.id) <= 0 ||
        !('login' in user) ||
        typeof user.login !== 'string'
      )
        throw new RepositoryError('github_invalid_response', 502)
      return { id: Number(user.id), login: user.login }
    }

    const assignees: IssueUser[] = item.assignees.map(readUser)
    const issue = {
      id: item.id as number,
      number: item.number as number,
      title: item.title as string,
      state,
      state_reason: (item.state_reason as string | null | undefined) ?? null,
      labels,
      created_at: item.created_at as string,
      updated_at: item.updated_at as string,
      closed_at: item.closed_at as string | null,
      author: item.user === null ? null : readUser(item.user),
      assignees,
      comments: item.comments as number,
    }
    issues.push(issue)
  }

  let nextPage: number | null = null
  const next = link?.split(',').find((part) => /;\s*rel="next"/.test(part))
  if (reason) {
    nextPage = page * perPage < Math.min(totalCount, 1000) ? page + 1 : null
  } else if (next) {
    const target = next.match(/<([^>]+)>/)?.[1]
    if (!target) throw new RepositoryError('github_invalid_response', 502)
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw new RepositoryError('github_invalid_response', 502)
    }
    const candidate = Number(url.searchParams.get('page'))
    if (
      url.origin !== 'https://api.github.com' ||
      url.username ||
      url.password ||
      !Number.isSafeInteger(candidate) ||
      candidate !== page + 1
    )
      throw new RepositoryError('github_invalid_response', 502)
    nextPage = candidate
  }
  return {
    issues,
    page,
    perPage,
    nextPage,
    category: category ?? null,
    searchLimited: reason !== null && totalCount > 1000,
  }
}
