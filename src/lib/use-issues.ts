import { useEffect } from 'react'
import {
  useInfiniteQuery,
  useIsFetching,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { defaultStatuses, fetchIssuePage, IssueReadError } from '@/lib/issues'
import type { ClosedIssueStatus, IssuePage } from '@/lib/issues'
import { getIssueStatus } from '@/lib/issues'
import type { IssueDetail } from '@/lib/use-issue-detail'
import { requestIssueRead } from '@/lib/use-issue-detail'

/** Keep independent pages while reconciling delayed Search results against accepted detail responses. */
export function useIssues(
  userId: string,
  repositoryId: number,
  state: 'open' | 'closed',
  enabled: boolean,
  category?: ClosedIssueStatus,
) {
  const client = useQueryClient()
  const perPage = state === 'closed' ? 10 : 100
  const closedCategory = state === 'closed' ? (category ?? 'done') : null
  const definition = defaultStatuses.find(
    (status) => status.id === closedCategory,
  )
  const reason = definition?.state === 'closed' ? definition.reason : null
  const queryKey = [
    'github',
    userId,
    repositoryId,
    'issues',
    state,
    {
      category: closedCategory,
      reason,
      perPage,
      sort: 'updated',
      direction: 'desc',
    },
  ] as const
  const refreshKey = [...queryKey, 'refresh'] as const
  const previousError = client.getQueryState(queryKey)?.error
  const previousRefreshError = client.getQueryState(refreshKey)?.error
  const isRefreshing = useIsFetching({ queryKey: refreshKey, exact: true }) > 0
  const options = {
    queryKey,
    queryFn: async (
      context: QueryFunctionContext<typeof queryKey | typeof refreshKey, number>,
    ) => {
      // Let StrictMode's synchronous remount reuse the request before consuming its abort signal.
      await Promise.resolve()
      const { pageParam, signal } = context
      const errors =
        context.queryKey.length === refreshKey.length
          ? [previousError, previousRefreshError]
          : [previousError]
      for (const error of errors) {
        if (error instanceof IssueReadError && error.retryAt > Date.now())
          throw error
      }
      const page = await fetchIssuePage(
        userId,
        repositoryId,
        state,
        pageParam,
        perPage,
        signal,
        closedCategory,
      )
      // Recent successful mutations bridge Search indexing delay without seeding fake pages.
      const writes = client.getMutationCache().getAll().filter((mutation) => {
        const key = mutation.options.mutationKey
        return key?.[0] === 'github' && key[1] === userId && key[2] === repositoryId &&
          key[3] === 'write' && mutation.state.status === 'success'
      }).map((mutation) => mutation.state.data as IssueDetail)
      const numbers = [...new Set(writes.map((issue) => issue.number))]
      if (pageParam === 1) {
        // Refresh only recently written resources, so another user's later edit is respected too.
        await Promise.all(numbers.map((number) => client.fetchQuery({
          queryKey: ['github', userId, repositoryId, 'issue', number],
          staleTime: 0,
          retry: false,
          queryFn: async ({ signal }): Promise<IssueDetail> => {
            const data = await requestIssueRead(`/api/repositories/${repositoryId}/issues/${number}`, signal)
            if (data?.userId !== userId)
              throw new IssueReadError('Your GitHub session changed. Connect GitHub again.', 401)
            if (data.repositoryId !== repositoryId || data.issue?.number !== number)
              throw new IssueReadError('The server returned invalid issue content.', 502)
            return data.issue
          },
        })))
      }
      const known = numbers.flatMap((number) => {
        const issue = client.getQueryData<IssueDetail>(['github', userId, repositoryId, 'issue', number])
        return issue ? [issue] : []
      })
      const latest = new Map(known.map((issue) => [issue.id, issue]))
      const issues = page.issues.map((issue) => {
        const detail = latest.get(issue.id)
        return detail && detail.updated_at >= issue.updated_at ? detail : issue
      }).filter((issue) => issue.state === state &&
        (!closedCategory || getIssueStatus(issue).status === closedCategory))
      if (pageParam === 1) {
        for (const issue of known) {
          if (issue.state === state && (!closedCategory || getIssueStatus(issue).status === closedCategory) &&
            !page.issues.some((item) => item.id === issue.id)) issues.push(issue)
        }
      }
      const searchPending = page.searchPending || (state === 'closed' && (
        issues.length !== page.issues.length || issues.some((issue, index) =>
          issue.id !== page.issues[index]?.id || issue.updated_at !== page.issues[index]?.updated_at ||
          issue.state_reason !== page.issues[index]?.state_reason,
        )
      ))
      return { ...page, issues, searchPending }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage: IssuePage) => lastPage.nextPage ?? undefined,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
  const query = useInfiniteQuery(options)
  const { hasNextPage, isFetching, isError, isPaused, fetchNextPage } = query
  const loadedPages = query.data?.pages.length ?? 0

  useEffect(() => {
    if (
      state === 'open' &&
      enabled &&
      hasNextPage &&
      !isFetching &&
      !isRefreshing &&
      !isError &&
      !isPaused
    ) {
      void fetchNextPage({ cancelRefetch: false })
    }
  }, [
    state,
    enabled,
    hasNextPage,
    isFetching,
    isRefreshing,
    isError,
    isPaused,
    fetchNextPage,
    loadedPages,
  ])

  /** Stage new pages separately so failed refreshes preserve accepted data and pagination state. */
  async function refresh() {
    await client.cancelQueries({ queryKey, exact: true })
    const data = await client.fetchInfiniteQuery({
      ...options,
      queryKey: refreshKey,
      staleTime: 0,
      // Open refresh follows every new page; Closed refresh only revalidates its loaded depth.
      pages: state === 'open' ? Infinity : Math.max(1, loadedPages),
    })
    // A workspace may remount while the staged read is running; cancel any resumed old pagination.
    await client.cancelQueries({ queryKey, exact: true })
    client.setQueryData(queryKey, data)
    client.removeQueries({ queryKey: refreshKey, exact: true })
    return data
  }

  return { ...query, refresh, isRefreshing }
}
