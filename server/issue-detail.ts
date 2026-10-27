import { githubResponse, RepositoryError } from './repositories.ts'
import { defaultStatuses } from './issue-status.ts'

/** Accept only the public identity used by the reading view, including deleted accounts. */
function readUser(value: unknown) {
  if (value === null) return null
  const user = value as Record<string, unknown> | null
  if (
    !user || typeof user !== 'object' || Array.isArray(user) ||
    !Number.isSafeInteger(user.id) || Number(user.id) <= 0 ||
    typeof user.login !== 'string'
  ) throw new RepositoryError('github_invalid_response', 502)
  return { id: Number(user.id), login: user.login }
}

/** Require a valid provider timestamp before displaying or sorting activity. */
function readDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new RepositoryError('github_invalid_response', 502)
  return value
}

/** Read the issue resource through the shared integration and explicitly exclude pull requests. */
async function readIssue(accessToken: string, repositoryId: number, number: number) {
  let record: unknown
  try {
    record = (await githubResponse(`/repositories/${repositoryId}/issues/${number}`, accessToken)).data
  } catch (error) {
    if (error instanceof RepositoryError && error.status === 404)
      throw new RepositoryError('issue_not_found', 404)
    throw error
  }
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new RepositoryError('github_invalid_response', 502)
  if ('pull_request' in record) throw new RepositoryError('issue_not_found', 404)
  return record as Record<string, unknown>
}

/** Project raw Markdown and safe metadata without saving any issue content. */
export async function readIssueDetail(accessToken: string, repositoryId: number, number: number) {
  const item = await readIssue(accessToken, repositoryId, number)
  const { data } = await githubResponse(`/repositories/${repositoryId}`, accessToken)
  return projectIssueDetail(item, data, repositoryId, number)
}

/** Validate reads and write responses identically without replacing the returned GitHub issue. */
export function projectIssueDetail(
  record: unknown, data: unknown, repositoryId: number, number: number,
) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
    'pull_request' in record || !data || typeof data !== 'object' || Array.isArray(data))
    throw new RepositoryError('github_invalid_response', 502)
  const item = record as Record<string, unknown>
  const repository = data as Record<string, unknown>
  if (
    repository.id !== repositoryId ||
    typeof repository.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name) ||
    typeof repository.default_branch !== 'string' || !repository.default_branch ||
    !Number.isSafeInteger(item.id) || Number(item.id) <= 0 || item.number !== number ||
    typeof item.title !== 'string' || !(item.body === null || typeof item.body === 'string') ||
    (item.state !== 'open' && item.state !== 'closed') ||
    !(item.state_reason == null || typeof item.state_reason === 'string') ||
    !Array.isArray(item.labels) || !Array.isArray(item.assignees) ||
    !Number.isSafeInteger(item.comments) || Number(item.comments) < 0
  ) throw new RepositoryError('github_invalid_response', 502)
  const labels = item.labels.map((value: unknown) => {
    if (typeof value === 'string') return { id: null, name: value, color: null }
    const label = value as Record<string, unknown> | null
    if (
      !label || typeof label !== 'object' || Array.isArray(label) ||
      !Number.isSafeInteger(label.id) || Number(label.id) <= 0 ||
      typeof label.name !== 'string' ||
      !(label.color === null || (typeof label.color === 'string' && /^[a-f0-9]{6}$/i.test(label.color)))
    ) throw new RepositoryError('github_invalid_response', 502)
    return { id: Number(label.id), name: label.name, color: label.color as string | null }
  })
  return {
    id: Number(item.id), number, title: item.title, body: item.body,
    state: item.state as 'open' | 'closed',
    state_reason: (item.state_reason as string | null | undefined) ?? null,
    labels, assignees: item.assignees.map(readUser).filter((user) => user !== null),
    author: readUser(item.user),
    created_at: readDate(item.created_at), updated_at: readDate(item.updated_at),
    closed_at: item.closed_at === null ? null : readDate(item.closed_at),
    comments: Number(item.comments),
    html_url: `https://github.com/${repository.full_name}/issues/${number}`,
    full_name: repository.full_name,
    default_branch: repository.default_branch,
  }
}

/** Return one bounded comments page, verifying issue identity and accepting only a sequential next link. */
export async function readIssueComments(
  accessToken: string, repositoryId: number, number: number, page: number, perPage: number,
) {
  // Comments endpoints also accept PRs, so each page verifies the parent resource first.
  const issue = await readIssue(accessToken, repositoryId, number)
  if (issue.number !== number || typeof issue.html_url !== 'string')
    throw new RepositoryError('github_invalid_response', 502)
  let issueUrl: URL
  try { issueUrl = new URL(issue.html_url) } catch {
    throw new RepositoryError('github_invalid_response', 502)
  }
  if (issueUrl.origin !== 'https://github.com' || issueUrl.username || issueUrl.password ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(issueUrl.pathname) ||
    !issueUrl.pathname.endsWith(`/issues/${number}`))
    throw new RepositoryError('github_invalid_response', 502)
  const { data, link } = await githubResponse(
    `/repositories/${repositoryId}/issues/${number}/comments?page=${page}&per_page=${perPage}`, accessToken,
  )
  if (!Array.isArray(data) || data.length > perPage)
    throw new RepositoryError('github_invalid_response', 502)
  const comments = data.map((value: unknown) => projectIssueComment(value, `${issueUrl.origin}${issueUrl.pathname}`))
  let nextPage: number | null = null
  const next = link?.split(',').find((part) => /;\s*rel="next"/.test(part))
  if (next) {
    const target = next.match(/<([^>]+)>/)?.[1]
    let url: URL
    try { url = new URL(target ?? '') } catch {
      throw new RepositoryError('github_invalid_response', 502)
    }
    const candidate = Number(url.searchParams.get('page'))
    if (url.origin !== 'https://api.github.com' || url.username || url.password ||
      !Number.isSafeInteger(candidate) || candidate !== page + 1)
      throw new RepositoryError('github_invalid_response', 502)
    nextPage = candidate
  }
  return { comments, page, perPage, nextPage }
}

/** Project both fetched and newly created comments through the same safe reading representation. */
export function projectIssueComment(value: unknown, issueUrl: string) {
  const item = value as Record<string, unknown> | null
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
    !Number.isSafeInteger(item.id) || Number(item.id) <= 0 ||
    !(item.body === null || typeof item.body === 'string'))
    throw new RepositoryError('github_invalid_response', 502)
  return {
    id: Number(item.id), body: item.body as string | null,
    author: readUser(item.user),
    created_at: readDate(item.created_at), updated_at: readDate(item.updated_at),
    html_url: `${issueUrl}#issuecomment-${item.id}`,
  }
}

/** Enumerate the current repository's existing choices without accepting a partial options list. */
export async function readIssueOptions(access: string, repositoryId: number, kind: 'labels' | 'assignees') {
  const { data: metadata } = await githubResponse(`/repositories/${repositoryId}`, access)
  const repository = metadata as Record<string, unknown>
  if (repository.id !== repositoryId || typeof repository.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name))
    throw new RepositoryError('github_invalid_response', 502)
  const labels: { id: number; name: string; color: string }[] = []
  const assignees: { id: number; login: string }[] = []
  for (let page = 1; ; page++) {
    const path = `/repos/${repository.full_name}/${kind}`
    const { data, link } = await githubResponse(`${path}?per_page=100&page=${page}`, access)
    if (!Array.isArray(data) || data.length > 100) throw new RepositoryError('github_invalid_response', 502)
    for (const value of data) {
      if (kind === 'assignees') {
        const user = readUser(value)
        if (!user) throw new RepositoryError('github_invalid_response', 502)
        assignees.push(user)
      } else {
        const label = value as Record<string, unknown> | null
        if (!label || !Number.isSafeInteger(label.id) || Number(label.id) <= 0 ||
          typeof label.name !== 'string' || typeof label.color !== 'string' || !/^[a-f0-9]{6}$/i.test(label.color))
          throw new RepositoryError('github_invalid_response', 502)
        const name = label.name
        if (!defaultStatuses.some((status) => status.state === 'open' && status.label === name.toLowerCase()))
          labels.push({ id: Number(label.id), name: label.name, color: label.color })
      }
    }
    const next = link?.split(',').find((part) => /;\s*rel="next"/.test(part))
    if (!next) break
    let target: URL
    try { target = new URL(next.match(/<([^>]+)>/)?.[1] ?? '') } catch {
      throw new RepositoryError('github_invalid_response', 502)
    }
    if (target.origin !== 'https://api.github.com' || target.username || target.password ||
      ![path, `/repositories/${repositoryId}/${kind}`].includes(target.pathname) ||
      Number(target.searchParams.get('page')) !== page + 1 || target.searchParams.get('per_page') !== '100')
      throw new RepositoryError('github_invalid_response', 502)
  }
  return { labels, assignees }
}
