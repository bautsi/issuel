import {
  useInfiniteQuery,
  useIsFetching,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import type { readIssueSearch } from '../../server/issue-search'
import type { readIssueOptions } from '../../server/issue-detail'
import { IssueReadError } from '@/lib/issues'
import { requestIssueRead } from '@/lib/use-issue-detail'

type SearchPage = Awaited<ReturnType<typeof readIssueSearch>> & {
  userId: string
  repositoryId: number
}

/** Keep independent search cursors per status and allow grouped views to disable the shared query. */
export function useIssueSearch(
  userId: string,
  repositoryId: number,
  text: string,
  status: string,
  label: string,
  sort: string,
  labelsOpen: boolean,
  groupByStatus: boolean,
  enabled = true,
) {
  const client = useQueryClient()
  const active = !groupByStatus || !!text || status !== 'all' || !!label
  const queryKey = [
    'github',
    userId,
    repositoryId,
    'issue-search',
    { text, status, label, sort, perPage: 30 },
  ] as const
  const refreshKey = [...queryKey, 'refresh'] as const
  const isRefreshing = useIsFetching({ queryKey: refreshKey, exact: true }) > 0
  const isFetching =
    useIsFetching({
      queryKey: groupByStatus
        ? ['github', userId, repositoryId, 'issue-search']
        : queryKey,
    }) > 0
  const previousError = client.getQueryState(queryKey)?.error
  const previousRefreshError = client.getQueryState(refreshKey)?.error
  const options = {
    queryKey,
    queryFn: async (
      context: QueryFunctionContext<
        typeof queryKey | typeof refreshKey,
        number
      >,
    ): Promise<SearchPage> => {
      await Promise.resolve()
      const { pageParam, signal } = context
      const limited = client
        .getQueryCache()
        .findAll({ queryKey: ['github', userId] })
        .map((query) => query.state.error)
        .find(
          (error) =>
            error instanceof IssueReadError &&
            error.status === 429 &&
            error.retryAt > Date.now(),
        )
      for (const error of [limited, previousError, previousRefreshError]) {
        if (error instanceof IssueReadError && error.retryAt > Date.now())
          throw error
      }
      const parameters = new URLSearchParams({
        q: text,
        status,
        label,
        sort,
        page: String(pageParam),
      })
      const data = await requestIssueRead(
        `/api/repositories/${repositoryId}/search?${parameters}`,
        signal,
      )
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (
        data.repositoryId !== repositoryId ||
        data.page !== pageParam ||
        data.perPage !== 30 ||
        !Array.isArray(data.issues) ||
        !Number.isSafeInteger(data.totalCount) ||
        data.totalCount < 0 ||
        typeof data.searchLimited !== 'boolean' ||
        typeof data.incompleteResults !== 'boolean' ||
        data.nextPage !==
          (pageParam * 30 < Math.min(data.totalCount, 1000)
            ? pageParam + 1
            : null)
      )
        throw new IssueReadError(
          'The server returned an invalid issue page.',
          502,
        )
      return data
    },
    initialPageParam: 1,
    getNextPageParam: (page: SearchPage) => page.nextPage ?? undefined,
    enabled: active && enabled,
    staleTime: 0,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
  const query = useInfiniteQuery(options)
  const labelsKey = [
    'github',
    userId,
    repositoryId,
    'options',
    'labels',
  ] as const
  const previousLabelsError = client.getQueryState(labelsKey)?.error
  const labels = useQuery({
    queryKey: labelsKey,
    queryFn: async (
      context,
    ): Promise<Awaited<ReturnType<typeof readIssueOptions>>> => {
      await Promise.resolve()
      if (
        previousLabelsError instanceof IssueReadError &&
        previousLabelsError.retryAt > Date.now()
      )
        throw previousLabelsError
      const data = await requestIssueRead(
        `/api/repositories/${repositoryId}/labels`,
        context.signal,
      )
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (data.repositoryId !== repositoryId || !Array.isArray(data.labels))
        throw new IssueReadError(
          'The server returned invalid issue content.',
          502,
        )
      return data
    },
    enabled: labelsOpen,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  /** Replace accepted results only after a successful first-page refresh of these conditions. */
  async function refresh() {
    await client.cancelQueries({ queryKey, exact: true })
    const data = await client.fetchInfiniteQuery({
      ...options,
      queryKey: refreshKey,
      staleTime: 0,
      pages: 1,
    })
    await client.cancelQueries({ queryKey, exact: true })
    // A late refresh after logout must not restore cleared private results.
    if (!client.getQueryData(['github', userId, 'repositories'])) return
    client.setQueryData(queryKey, data)
    client.removeQueries({ queryKey: refreshKey, exact: true })
  }
  return { ...query, active, labels, refresh, isRefreshing, isFetching }
}
