import { useEffect } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { defaultStatuses, fetchIssuePage, IssueReadError } from '@/lib/issues'
import type { ClosedIssueStatus } from '@/lib/issues'

/** Isolate each Closed reason's search cache from label-based pages and other groups. */
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
  const previousError = client.getQueryState(queryKey)?.error
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => {
      if (
        previousError instanceof IssueReadError &&
        previousError.retryAt > Date.now()
      )
        throw previousError
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
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const { hasNextPage, isFetching, isError, isPaused, fetchNextPage } = query
  const loadedPages = query.data?.pages.length ?? 0

  useEffect(() => {
    if (
      state === 'open' &&
      enabled &&
      hasNextPage &&
      !isFetching &&
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
    isError,
    isPaused,
    fetchNextPage,
    loadedPages,
  ])

  return query
}
