import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  readIssueComments,
  readIssueDetail,
  readIssueOptions,
} from '../../server/issue-detail'
import { IssueReadError } from '@/lib/issues'

export type IssueDetail = Awaited<ReturnType<typeof readIssueDetail>>
export type CommentsPage = Awaited<ReturnType<typeof readIssueComments>> & {
  userId: string
  repositoryId: number
  number: number
}

/** Distinguish invalid local parameters from provider rejection without exposing provider bodies. */
export async function requestIssueRead(path: string, signal: AbortSignal) {
  let response: Response
  try {
    response = await fetch(path, { signal, cache: 'no-store' })
  } catch (error) {
    if (signal.aborted) throw error
    throw new IssueReadError(
      'Unable to reach the server. Check your connection and retry.',
    )
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Your session has expired. Connect GitHub again.',
      403: 'GitHub denied issue access. Check the App Issues permission and your repository access.',
      404:
        data?.error === 'issue_not_found'
          ? 'Issue not found or no longer accessible. Pull requests are not supported here.'
          : 'This repository no longer exists or is not accessible to your account and App.',
      422:
        data?.error === 'invalid_search_parameters'
          ? 'Search parameters are invalid. Check the submitted text and filters.'
          : data?.error === 'github_search_rejected'
            ? 'GitHub rejected this search.'
            : 'GitHub rejected this request.',
      429: 'GitHub rate limit reached. Please wait before retrying.',
    }
    const delay = Number(response.headers.get('Retry-After'))
    throw new IssueReadError(
      (data?.error === 'github_search_stale'
        ? 'GitHub search is catching up with issue changes. This page was not accepted; refresh later.'
        : data?.error === 'github_search_mismatch'
          ? 'GitHub returned results outside this repository or included pull requests. This page was not accepted.'
          : messages[response.status]) ??
        'Issue content could not be loaded. Please retry shortly.',
      response.status,
      Number.isSafeInteger(delay) && delay > 0
        ? delay
        : response.status === 429
          ? 60
          : 0,
    )
  }
  return data
}

/** Isolate issue reads and fetch newest-first comment pages using GitHub's previous-page cursors. */
export function useIssueDetail(
  userId: string,
  repositoryId: number | null,
  number: number,
  selector: 'labels' | 'assignees' | null = null,
) {
  const client = useQueryClient()
  const queryKey = ['github', userId, repositoryId, 'issue', number] as const
  const commentsKey = [...queryKey, 'comments', 'newest-first'] as const
  const path = `/api/repositories/${repositoryId}/issues/${number}`
  // Refetch clears query.error before invoking the query function; retain the accepted deadline first.
  const previousDetailError = client.getQueryState(queryKey)?.error
  const previousCommentsError = client.getQueryState(commentsKey)?.error
  const detail = useQuery({
    queryKey,
    queryFn: async (context): Promise<IssueDetail> => {
      // Share StrictMode's immediate remount before consuming the cancellation signal.
      await Promise.resolve()
      const { signal } = context
      const error = previousDetailError
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        throw error
      const data = await requestIssueRead(path, signal)
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (data.repositoryId !== repositoryId || data.issue?.number !== number)
        throw new IssueReadError(
          'The server returned invalid issue content.',
          502,
        )
      return data.issue
    },
    enabled: repositoryId !== null,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'always',
  })
  const comments = useInfiniteQuery({
    queryKey: commentsKey,
    queryFn: async (context): Promise<CommentsPage> => {
      await Promise.resolve()
      const { pageParam, signal } = context
      const error = previousCommentsError
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        throw error
      const data = await requestIssueRead(
        `${path}/comments?per_page=30${pageParam === null ? '' : `&page=${pageParam}`}`,
        signal,
      )
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (
        data.repositoryId !== repositoryId ||
        data.number !== number ||
        !Number.isSafeInteger(data.page) ||
        data.page < 1 ||
        (pageParam !== null && data.page !== pageParam) ||
        data.perPage !== 30 ||
        !Array.isArray(data.comments) ||
        data.nextPage !== (data.page === 1 ? null : data.page - 1)
      )
        throw new IssueReadError(
          'The server returned invalid issue content.',
          502,
        )
      return data
    },
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: repositoryId !== null && detail.isSuccess,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    networkMode: 'always',
  })
  const optionsKey = [
    'github',
    userId,
    repositoryId,
    'options',
    selector,
  ] as const
  const previousOptionsError = client.getQueryState(optionsKey)?.error
  const options = useQuery({
    queryKey: optionsKey,
    queryFn: async ({
      signal,
    }): Promise<Awaited<ReturnType<typeof readIssueOptions>>> => {
      if (
        previousOptionsError instanceof IssueReadError &&
        previousOptionsError.retryAt > Date.now()
      )
        throw previousOptionsError
      const data = await requestIssueRead(
        `/api/repositories/${repositoryId}/${selector}`,
        signal,
      )
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (
        data.repositoryId !== repositoryId ||
        !Array.isArray(data.labels) ||
        !Array.isArray(data.assignees)
      )
        throw new IssueReadError(
          'The server returned invalid issue content.',
          502,
        )
      return data
    },
    enabled: repositoryId !== null && selector !== null && detail.isSuccess,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: 'always',
  })
  return { detail, comments, options }
}
