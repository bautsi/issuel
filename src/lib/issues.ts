import type { readIssues } from '../../server/issues'
import type { ClosedIssueStatus } from '../../server/issue-status'
import { defaultStatuses } from '../../server/issue-status'

export type IssuePage = Awaited<ReturnType<typeof readIssues>> & {
  userId: string
  repositoryId: number
  state: 'open' | 'closed'
}
export type Issue = IssuePage['issues'][number]
export { defaultStatuses, getIssueStatus } from '../../server/issue-status'
export type { IssueStatus, ClosedIssueStatus } from '../../server/issue-status'

/** Retain only safe UI messages, HTTP status and the earliest permitted retry time. */
export class IssueReadError extends Error {
  status: number
  retryAt: number

  /** Keep a safe message key and the retry deadline without storing the raw GitHub response. */
  constructor(message: string, status = 503, retryAfter = 0) {
    super(message)
    this.status = status
    this.retryAt = Date.now() + retryAfter * 1000
  }
}

/** Validate state/reason-specific pages and expose safe Search failures without discarding earlier pages. */
export async function fetchIssuePage(
  userId: string,
  repositoryId: number,
  state: 'open' | 'closed',
  page: number,
  perPage: number,
  signal: AbortSignal,
  category: ClosedIssueStatus | null,
): Promise<IssuePage> {
  let response: Response
  try {
    response = await fetch(
      `/api/repositories/${repositoryId}/issues?state=${state}&page=${page}&per_page=${perPage}${category ? `&category=${category}` : ''}`,
      {
        signal,
        cache: 'no-store',
      },
    )
  } catch (error) {
    if (signal.aborted) throw error
    throw new IssueReadError(
      'Unable to reach the server. Check your connection and retry.',
    )
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const delay = Number(response.headers.get('Retry-After'))
    const retryAfter =
      Number.isSafeInteger(delay) && delay > 0
        ? delay
        : response.status === 429
          ? 60
          : 0
    const messages: Record<number, string> = {
      401: 'Your session has expired. Connect GitHub again.',
      403: 'GitHub denied issue access. Check the App Issues permission and your repository access.',
      404: 'This repository no longer exists or is not accessible to your account and App.',
      429: 'GitHub rate limit reached. Please wait before retrying.',
    }
    const searchMessages: Record<string, string> = {
      github_search_incomplete:
        'GitHub search timed out with incomplete results. Retry this page.',
      github_search_mismatch:
        'GitHub returned issues that do not match this closed reason. This page was not accepted.',
    }
    throw new IssueReadError(
      searchMessages[data?.error] ??
        messages[response.status] ??
        'Issues could not be loaded. Please retry shortly.',
      response.status,
      retryAfter,
    )
  }
  if (data?.userId !== userId)
    throw new IssueReadError(
      'Your GitHub session changed. Connect GitHub again.',
      401,
    )
  const definition = defaultStatuses.find((status) => status.id === category)
  const reason = definition?.state === 'closed' ? definition.reason : null
  if (
    data.repositoryId !== repositoryId ||
    data.state !== state ||
    data.category !== category ||
    data.page !== page ||
    data.perPage !== perPage ||
    !Array.isArray(data.issues) ||
    typeof data.searchLimited !== 'boolean' ||
    (reason &&
      data.issues.some(
        (issue: Issue) =>
          issue.state !== 'closed' || issue.state_reason !== reason,
      )) ||
    !(
      data.nextPage === null ||
      (Number.isSafeInteger(data.nextPage) && data.nextPage === page + 1)
    )
  )
    throw new IssueReadError('The server returned an invalid issue page.', 502)
  return data
}
