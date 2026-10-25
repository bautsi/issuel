import { useEffect } from 'react'
import {
  useInfiniteQuery,
  useIsFetching,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { defaultStatuses, fetchIssuePage, IssueReadError } from '@/lib/issues'
import type { ClosedIssueStatus, IssuePage } from '@/lib/issues'

/** Keep accepted pages and pagination errors separate from unsuccessful list refreshes. */
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
      return fetchIssuePage(
        userId,
        repositoryId,
        state,
        pageParam,
        perPage,
        signal,
        closedCategory,
      )
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
