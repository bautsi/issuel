import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { NewIssue } from '@/components/new-issue'
import { RepositorySettings } from '@/components/repository-settings'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getIssueStatus, IssueReadError } from '@/lib/issues'
import {
  useRepositoryConfig,
  useRepositoryStatuses,
} from '@/lib/use-repository-config'
import type { Issue, IssueStatus } from '@/lib/issues'
import { useIssues } from '@/lib/use-issues'
import { useIssueSearch } from '@/lib/use-issue-search'
import {
  readWorkspacePreferences,
  writeWorkspacePreferences,
} from '@/lib/workspace-preferences'
import type { WorkspacePreferences } from '@/lib/workspace-preferences'

/** Use distinct progress fills for active statuses and compact terminal/conflict markers. */
export function StatusIcon({ status }: { status: IssueStatus | 'conflict' }) {
  const styles = {
    inProgress:
      'rounded-full border-2 border-yellow-400 bg-linear-to-r from-yellow-400 from-50% to-transparent to-50%',
    inReview:
      'rounded-full border-2 border-current text-[#26a644] bg-[conic-gradient(currentColor_0deg_270deg,transparent_270deg_360deg)]',
    todo: 'rounded-full border-2 border-zinc-400',
    backlog: 'rounded-full border-2 border-dashed border-zinc-500',
    done: 'rounded-full bg-violet-400 text-background',
    canceled: 'rounded-full bg-zinc-500 text-background',
    duplicate: 'rounded-full border-2 border-zinc-400 text-zinc-400',
    conflict: 'rounded-sm bg-amber-400 text-background',
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-4 shrink-0 items-center justify-center text-[11px] font-bold ${styles[status]}`}
    >
      {status === 'done'
        ? '✓'
        : status === 'canceled'
          ? '×'
          : status === 'duplicate'
            ? '='
            : status === 'conflict'
              ? '!'
              : null}
    </span>
  )
}

/** Open a repository-scoped detail while preserving the list's search parameters. */
function IssueRow({ issue }: { issue: Issue }) {
  const { data: config } = useRepositoryConfig()
  const groups = useRepositoryStatuses()
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const mapped = getIssueStatus(issue, config.mapping)
  const statusName = t(
    mapped.status === 'conflict'
      ? 'Mapping conflict'
      : groups.find((group) => group.id === mapped.status)!.title,
  )
  return (
    <li className="relative flex h-11 min-w-0 items-center gap-2 border-t px-4 text-sm hover:bg-muted/30 focus-within:bg-muted/30 sm:gap-3">
      {/* Issue identity and vertically centered status */}
      <span className="flex shrink-0 items-center">
        <StatusIcon status={mapped.status} />
      </span>
      <span
        className="hidden w-12 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:block"
        title={`GitHub #${issue.number}`}
      >
        #{issue.number}
      </span>
      <span className="sr-only">{statusName}: </span>

      {/* The title owns remaining space and never pushes the metadata out of the row */}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Link
            to={`${location.pathname}/issue/${issue.number}${location.search}`}
            state={location.state}
            aria-label={`#${issue.number} ${issue.title}`}
            className="min-w-4 flex-[1_1_auto] truncate rounded-sm font-medium leading-5 outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {issue.title}
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="pointer-events-none wrap-break-word"
        >
          {issue.title}
        </TooltipContent>
      </Tooltip>

      {/* Mapping conflicts remain explicit without adding another line */}
      {mapped.conflictingLabels.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="shrink-0 rounded border border-amber-400/30 px-1.5 py-0.5 text-[10px] text-amber-300 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('Conflict')}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="wrap-break-word">
            {t('Conflicting status labels: {{labels}}', {
              labels: mapped.conflictingLabels.join(', '),
            })}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Labels stay apart at natural width and overlap only as their wrappers shrink */}
      {mapped.labels.length > 0 && (
        <button
          type="button"
          aria-label={t('Labels: {{labels}}', {
            labels: mapped.labels.map((label) => label.name).join(', '),
          })}
          className="flex h-7 min-w-7 flex-[0_1.5_auto] items-center overflow-hidden rounded-full outline-none transition-[flex-shrink] duration-200 hover:shrink-[0.3] focus-visible:shrink-[0.3] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {mapped.labels.map((label, index) => (
              <span
                key={label.id ?? label.name}
                className="relative flex min-w-0 shrink last:shrink-[0.000001]"
              >
                <span
                  className={`relative inline-flex min-w-0 max-w-28 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground ${index === mapped.labels.length - 1 ? 'shrink' : 'shrink-0'}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
                    style={
                      label.color
                        ? { backgroundColor: `#${label.color}` }
                        : undefined
                    }
                  />
                  <span className="truncate">{label.name}</span>
                </span>
              </span>
            ))}
          </span>
        </button>
      )}

      {/* Compact assignee identity and date stay on the same line */}
      {issue.assignees.length > 0 && (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={t('Assignees: {{users}}', {
                users: issue.assignees.map((user) => user.login).join(', '),
              })}
              className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted text-[10px] font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {issue.assignees.length > 1
                ? issue.assignees.length
                : issue.assignees[0].login.slice(0, 1).toUpperCase()}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="end"
            className="pointer-events-none"
          >
            {issue.assignees.map((user) => `@${user.login}`).join(', ')}
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <time
            tabIndex={0}
            className="w-14 shrink-0 rounded-sm text-right text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-16"
            dateTime={issue.updated_at}
          >
            {new Date(issue.updated_at).toLocaleDateString(
              i18n.resolvedLanguage,
              { month: 'short', day: 'numeric' },
            )}
          </time>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="pointer-events-none"
        >
          {t('Updated {{date}}', {
            date: new Date(issue.updated_at).toLocaleString(
              i18n.resolvedLanguage,
            ),
          })}
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

/** Keep independent status pages and apply title ordering only to already loaded rows. */
function IssueSearchGroup({
  userId,
  repositoryId,
  group,
  text,
  label,
  sort,
  expanded,
  onToggle,
  onSessionExpired,
  cachedIssues,
}: {
  userId: string
  repositoryId: number
  group: { id: IssueStatus; title: string }
  text: string
  label: string
  sort: string
  expanded: boolean
  onToggle: () => void
  onSessionExpired: () => void
  cachedIssues: Issue[] | null
}) {
  const { t } = useTranslation()
  const { data: config } = useRepositoryConfig()
  const query = useIssueSearch(
    userId,
    repositoryId,
    text,
    group.id,
    label,
    sort === 'title' ? 'updated' : sort,
    false,
    false,
    expanded,
  )
  useEffect(() => {
    if (query.error instanceof IssueReadError && query.error.status === 401)
      onSessionExpired()
  }, [query.error, onSessionExpired])
  const pages = query.data?.pages ?? []
  const cached = !query.data && cachedIssues !== null
  const items = cached
    ? cachedIssues
        .filter(
          (issue) => getIssueStatus(issue, config.mapping).status === group.id,
        )
        .slice(0, 30)
    : [
        ...new Map(
          pages
            .flatMap((page) => page.issues)
            .map((issue) => [issue.id, issue]),
        ).values(),
      ]
  if (sort === 'title')
    items.sort((a, b) => a.title.localeCompare(b.title) || b.number - a.number)
  const incomplete = pages.some((page) => page.incompleteResults)
  const limited = pages.some((page) => page.searchLimited)
  const total = pages.at(-1)?.totalCount ?? 0
  return (
    <section aria-labelledby={`search-${group.id}-heading`}>
      {/* Each group retains its own expansion and accepted result counts */}
      <h3 id={`search-${group.id}-heading`}>
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls={`search-${group.id}-issues`}
          onClick={onToggle}
          className="h-auto w-full justify-start rounded-none border-x-0 border-b-0 bg-muted/30 px-4 py-3 text-xs shadow-none"
        >
          <span aria-hidden="true" className="w-2 text-muted-foreground">
            {expanded ? '▾' : '▸'}
          </span>
          <StatusIcon status={group.id} />
          {t(group.title)}
          <span className="font-normal text-muted-foreground">
            {query.data || cached
              ? t('{{count}} loaded', { count: items.length })
              : t('Not loaded')}
          </span>
          {(incomplete || limited || query.isError) && (
            <span className="ml-auto text-destructive">{t('Incomplete')}</span>
          )}
        </Button>
      </h3>

      {/* Cache remains visible while this group's query updates */}
      {expanded && (
        <div id={`search-${group.id}-issues`} aria-busy={query.isFetching}>
          {!query.data && !cached && !query.isError && (
            <p
              role="status"
              className="border-t px-4 py-3 text-xs text-muted-foreground"
            >
              {t(query.isPaused ? 'Waiting for a connection…' : 'Loading…')}
            </p>
          )}
          {query.data && (
            <p
              role="status"
              className="border-t px-4 py-3 text-xs text-muted-foreground"
            >
              {t(
                incomplete
                  ? '{{loaded}} loaded · GitHub reports {{total}} matches so far; results incomplete'
                  : '{{loaded}} loaded · {{total}} matches reported by GitHub',
                { loaded: items.length, total },
              )}
              {query.isRefetching && ` · ${t('Refreshing…')}`}
            </p>
          )}
          {cached && query.isFetching && (
            <p
              role="status"
              className="border-t px-4 py-3 text-xs text-muted-foreground"
            >
              {t('Refreshing…')}
            </p>
          )}
          {query.isError && (
            <p
              role="alert"
              className="border-t px-4 py-3 text-sm text-destructive"
            >
              {t(query.error.message)}
            </p>
          )}
          {query.isPaused && query.data && (
            <p
              role="status"
              className="px-4 py-3 text-xs text-muted-foreground"
            >
              {t('Waiting for a connection…')}
            </p>
          )}
          {limited && (
            <p role="status" className="px-4 py-3 text-xs text-amber-300">
              {t(
                'GitHub Search returns only the first 1,000 matches. Narrow the search to see other results.',
              )}
            </p>
          )}
          {incomplete && (
            <p role="status" className="px-4 py-3 text-xs text-amber-300">
              {t(
                'GitHub returned incomplete search results. Counts and pages may be partial; refresh to retry.',
              )}
            </p>
          )}

          {/* Only the current status's pages populate this list */}
          <ul aria-label={t('{{status}} issues', { status: t(group.title) })}>
            {items.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
          {query.data && total === 0 && !query.isError && !incomplete && (
            <p className="border-t px-4 py-5 text-xs text-muted-foreground">
              {t('No issues in this group.')}
            </p>
          )}

          {/* Failed pages retry within this group without discarding earlier accepted rows */}
          {(query.hasNextPage || query.isError) && (
            <Button
              variant="outline"
              aria-label={t('Load more {{status}} issues', {
                status: t(group.title),
              })}
              className="h-11 w-full rounded-none border-x-0 border-b-0 text-xs"
              disabled={
                query.isFetching || query.isRefreshing || query.isPaused
              }
              onClick={() =>
                void (query.data &&
                (!query.isError || query.isFetchNextPageError)
                  ? query.fetchNextPage({ cancelRefetch: false })
                  : query.refetch())
              }
            >
              {t(
                query.isFetching
                  ? 'Loading…'
                  : query.isError
                    ? 'Retry failed page'
                    : 'Load more…',
              )}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/** Keep repository settings beside refresh while retaining explicit search and independent group cursors. */
export function Workspace({
  userId,
  repository,
  onSessionExpired,
  scrollPositions,
}: {
  userId: string
  repository: {
    id: number
    full_name: string
    private: boolean
    permissions: Record<string, boolean>
    installations: { permissions: Record<string, string> }[]
  }
  onSessionExpired: () => void
  scrollPositions: RefObject<Map<number, number>>
}) {
  const { t } = useTranslation()
  const config = useRepositoryConfig()
  const groups = useRepositoryStatuses()
  const client = useQueryClient()
  const [searchParameters, setSearchParameters] = useSearchParams()
  const searchText = searchParameters.get('q') ?? ''
  const searchInput = useRef<HTMLInputElement>(null)
  const searchStatus = searchParameters.get('status') ?? 'all'
  const searchLabel = searchParameters.get('label') ?? ''
  const groupByStatus = searchParameters.get('group') !== 'none'
  const requestedSort = searchParameters.get('sort')
  const searchSort =
    requestedSort === 'created-desc' ||
    requestedSort === 'created-asc' ||
    requestedSort === 'title'
      ? requestedSort
      : 'updated'
  const githubSort = searchSort === 'title' ? 'updated' : searchSort
  const searchIdentity = JSON.stringify([
    searchText.trim(),
    searchStatus,
    searchLabel,
    searchSort,
  ])
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelText, setLabelText] = useState('')
  const labelInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!labelsOpen) return
    const timer = window.setTimeout(() => labelInput.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [labelsOpen])
  const [searchFailure, setSearchFailure] = useState<{
    identity: string
    error: IssueReadError
  } | null>(null)
  const search = useIssueSearch(
    userId,
    repository.id,
    searchText.trim(),
    searchStatus,
    searchLabel,
    githubSort,
    labelsOpen,
    groupByStatus,
    !groupByStatus,
  )
  const searchRefreshing = useRef(false)
  useLayoutEffect(() => {
    const positions = scrollPositions.current
    window.scrollTo(0, positions.get(repository.id) ?? 0)
    return () => {
      positions.set(repository.id, window.scrollY)
    }
  }, [repository.id, scrollPositions])
  const canWrite =
    repository.permissions.push &&
    repository.installations.some(
      (installation) => installation.permissions.issues === 'write',
    )
  const [stored, setStored] = useState(() =>
    readWorkspacePreferences(userId, repository.id),
  )
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<IssueReadError | null>(null)
  const refreshPending = useRef(false)
  const open = useIssues(
    userId,
    repository.id,
    'open',
    !refreshing && !search.active,
  )
  const done = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing &&
      !search.active &&
      !!open.data &&
      stored.preferences.expandedGroups.done,
    'done',
    githubSort,
  )
  const canceled = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing &&
      !search.active &&
      !!open.data &&
      stored.preferences.expandedGroups.canceled,
    'canceled',
    githubSort,
  )
  const duplicate = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing &&
      !search.active &&
      !!open.data &&
      stored.preferences.expandedGroups.duplicate,
    'duplicate',
    githubSort,
  )

  useEffect(() => {
    if (
      [
        open.error,
        done.error,
        canceled.error,
        duplicate.error,
        search.error,
        search.labels.error,
      ].some((error) => error instanceof IssueReadError && error.status === 401)
    ) {
      onSessionExpired()
    }
  }, [
    open.error,
    done.error,
    canceled.error,
    duplicate.error,
    search.error,
    search.labels.error,
    onSessionExpired,
  ])

  /** Apply toolbar changes and refresh only the resulting search or visible grouped ordering. */
  function updateSearch(parameter: string, value: string) {
    const next = new URLSearchParams(searchParameters)
    if (parameter === 'reset') {
      for (const filter of ['q', 'status', 'label']) next.delete(filter)
      if (searchInput.current) searchInput.current.value = ''
    } else if (
      value &&
      !(parameter === 'status' && value === 'all') &&
      !(parameter === 'sort' && value === 'updated')
    )
      next.set(parameter, value)
    else next.delete(parameter)

    const text = next.get('q')?.trim() ?? ''
    const status = next.get('status') ?? 'all'
    const label = next.get('label') ?? ''
    const requested = next.get('sort')
    const sort =
      requested === 'created-desc' || requested === 'created-asc'
        ? requested
        : 'updated'
    const prefix = ['github', userId, repository.id] as const
    setSearchFailure(null)
    setRefreshError(null)
    if (next.get('group') === 'none' || text || status !== 'all' || label) {
      // Cached inactive queries refresh when selected; active queries reuse any in-flight read.
      void client.invalidateQueries(
        {
          queryKey: [
            ...prefix,
            'issue-search',
            {
              text,
              label,
              sort,
              perPage: 30,
              ...(next.get('group') !== 'none' && status === 'all'
                ? {}
                : { status }),
            },
          ],
          predicate: (query) => query.queryKey.length === 5,
        },
        { cancelRefetch: false },
      )
    } else {
      // Keep Closed groups lazy and invalidate only the newly selected ordering.
      void Promise.all([
        client.invalidateQueries(
          {
            queryKey: [...prefix, 'issues', 'open'],
            predicate: (query) => query.queryKey.length === 6,
          },
          { cancelRefetch: false },
        ),
        client.invalidateQueries(
          {
            queryKey: [
              ...prefix,
              'issues',
              'closed',
              {
                sort: sort === 'updated' ? 'updated' : 'created',
                direction: sort === 'created-asc' ? 'asc' : 'desc',
              },
            ],
            predicate: (query) => query.queryKey.length === 6,
          },
          { cancelRefetch: false },
        ),
      ])
    }
    setSearchParameters(next, {
      replace: true,
      state: { userId, repositoryId: repository.id },
    })
  }

  /** Refresh active status searches independently or stage the current flat search's first page. */
  async function refreshSearch() {
    if (searchRefreshing.current || search.isRefreshing) return
    searchRefreshing.current = true
    setSearchFailure(null)
    try {
      const latestConfig = await config.refetch({ throwOnError: true })
      if (latestConfig.data?.sha !== config.data.sha) return
      if (groupByStatus)
        await client.refetchQueries(
          {
            queryKey: ['github', userId, repository.id, 'issue-search'],
            type: 'active',
          },
          { cancelRefetch: false, throwOnError: true },
        )
      else await search.refresh()
    } catch (error) {
      const failure =
        error instanceof IssueReadError
          ? error
          : new IssueReadError(
              'Issue content could not be loaded. Please retry shortly.',
            )
      if (failure.status === 401) onSessionExpired()
      setSearchFailure({ identity: searchIdentity, error: failure })
    } finally {
      searchRefreshing.current = false
    }
  }

  const listRefreshing =
    refreshing ||
    [open, done, canceled, duplicate].some(
      (query) => query.isRefreshing || query.isRefetching,
    )

  /** Refresh eligible queries while keeping failures out of accepted group and pagination state. */
  async function refreshIssues() {
    if (refreshPending.current || listRefreshing) return
    refreshPending.current = true
    setRefreshing(true)
    setRefreshError(null)
    try {
      await config.refetch({ throwOnError: true })
      const results = await Promise.allSettled(
        [
          open,
          ...(
            [
              ['done', done],
              ['canceled', canceled],
              ['duplicate', duplicate],
            ] as const
          )
            .filter(
              ([id, query]) =>
                stored.preferences.expandedGroups[id] && query.data,
            )
            .map(([, query]) => query),
        ].map(async (query) => {
          try {
            return await query.refresh()
          } catch (error) {
            if (error instanceof IssueReadError && error.status === 401)
              onSessionExpired()
            throw error
          }
        }),
      )
      const failure = results.find((result) => result.status === 'rejected')
      if (failure)
        setRefreshError(
          failure.reason instanceof IssueReadError
            ? failure.reason
            : new IssueReadError(
                'Issues could not be loaded. Please retry shortly.',
              ),
        )
    } catch (error) {
      if (error instanceof IssueReadError && error.status === 401)
        onSessionExpired()
      setRefreshError(
        error instanceof IssueReadError
          ? error
          : new IssueReadError(
              'Unable to load repository config. Check your connection and retry.',
            ),
      )
    } finally {
      refreshPending.current = false
      setRefreshing(false)
    }
  }

  /** Persist a group toggle or sort choice under this user's stable repository identity. */
  function savePreferences(preferences: WorkspacePreferences) {
    const saved = writeWorkspacePreferences(userId, repository.id, preferences)
    setStored({ preferences, unavailable: !saved })
  }

  /** Restore title ordering for loaded rows and keep date sorting aligned with provider queries. */
  function compareIssues(a: Issue, b: Issue) {
    if (searchSort === 'title')
      return a.title.localeCompare(b.title) || b.number - a.number
    const field = searchSort === 'updated' ? 'updated_at' : 'created_at'
    const direction = searchSort === 'created-asc' ? 1 : -1
    return (
      direction * (Date.parse(a[field]) - Date.parse(b[field])) ||
      direction * (a.number - b.number)
    )
  }
  // Open status labels are grouped locally; Closed queries already select their own status.
  const issues = [
    ...new Map(
      (open.data?.pages ?? [])
        .flatMap((page) => page.issues)
        .map((issue) => [issue.id, issue]),
    ).values(),
  ].sort(compareIssues)
  const mapped = issues.map((issue) => ({
    issue,
    status: getIssueStatus(issue, config.data.mapping).status,
  }))
  const conflicts = mapped.filter((item) => item.status === 'conflict')
  const openConflictCount = conflicts.filter(
    (item) => item.issue.state === 'open',
  ).length
  const openCount = issues.filter((issue) => issue.state === 'open').length
  const openCacheComplete = !!open.data && !open.hasNextPage
  const openComplete = openCacheComplete && !open.isError
  const cachedOpenMatches =
    openCacheComplete &&
    !searchText.trim() &&
    !searchLabel &&
    groups.some((group) => group.state === 'open' && group.id === searchStatus)
      ? mapped
          .filter((item) => item.status === searchStatus)
          .map((item) => item.issue)
      : null
  const showingCachedOpen = !search.data && cachedOpenMatches !== null
  const searchPages = search.data?.pages ?? []
  const searchIssues: Issue[] = showingCachedOpen
    ? cachedOpenMatches.slice(0, 30)
    : [
        ...new Map(
          searchPages
            .flatMap((page) => page.issues)
            .map((issue) => [issue.id, issue]),
        ).values(),
      ]
  const searchIncomplete = searchPages.some((page) => page.incompleteResults)
  if (searchSort === 'title')
    searchIssues.sort(
      (a, b) => a.title.localeCompare(b.title) || b.number - a.number,
    )
  const searchLimited = searchPages.some((page) => page.searchLimited)
  const searchTotal = showingCachedOpen
    ? cachedOpenMatches.length
    : (searchPages.at(-1)?.totalCount ?? 0)
  const searchError =
    searchFailure?.identity === searchIdentity
      ? searchFailure.error
      : search.error
  const searchPagination =
    search.hasNextPage || search.isError ? (
      <Button
        variant="outline"
        className="h-11 w-full rounded-none border-x-0 border-b-0 text-xs"
        disabled={search.isFetching || search.isRefreshing || search.isPaused}
        onClick={() =>
          void (search.data
            ? search.fetchNextPage({ cancelRefetch: false })
            : search.refetch())
        }
      >
        {t(
          search.isFetching
            ? 'Loading…'
            : search.isError
              ? 'Retry failed page'
              : 'Load more…',
        )}
      </Button>
    ) : null

  return (
    <TooltipProvider delayDuration={300}>
      {/* Workspace identity */}
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">
          {t('REPOSITORY WORKSPACE')}
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="wrap-break-word text-2xl font-semibold tracking-tight">
              {repository.full_name}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t('{{visibility}} repository · GitHub Issues', {
                visibility: t(repository.private ? 'Private' : 'Public'),
              })}
            </p>
          </div>

          {/* Repository actions */}
          <div className="ml-auto flex shrink-0 items-end gap-2">
            <Button
              variant="outline"
              aria-label={t(
                search.active
                  ? 'Refresh search'
                  : listRefreshing
                    ? 'Refreshing…'
                    : 'Refresh issues',
              )}
              aria-busy={
                search.active
                  ? search.isFetching || search.isRefreshing
                  : listRefreshing
              }
              title={t(
                search.active
                  ? 'Refresh search'
                  : listRefreshing
                    ? 'Refreshing…'
                    : 'Refresh issues',
              )}
              className="size-8 border-transparent bg-transparent p-0 text-muted-foreground shadow-none"
              disabled={
                search.active
                  ? search.isFetching || search.isRefreshing || search.isPaused
                  : listRefreshing || !open.data || open.isPaused
              }
              onClick={() =>
                void (search.active ? refreshSearch() : refreshIssues())
              }
            >
              <svg
                aria-hidden="true"
                className={`size-3.5 ${(search.active ? search.isFetching || search.isRefreshing : listRefreshing) ? 'motion-safe:animate-spin' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {(
                  search.active
                    ? search.isFetching || search.isRefreshing
                    : listRefreshing
                ) ? (
                  <>
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </>
                ) : (
                  <>
                    <path d="M20 7v5h-5M4 17v-5h5" />
                    <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
                  </>
                )}
              </svg>
            </Button>

            {/* Repository mapping settings sit beside manual refresh */}
            <RepositorySettings
              canWrite={
                !!repository.permissions.push &&
                repository.installations.some(
                  (installation) =>
                    installation.permissions.contents === 'write',
                )
              }
            />

            {/* Issue creation requires both user and App write access */}
            {canWrite && (
              <NewIssue
                userId={userId}
                repositoryId={repository.id}
                fullName={repository.full_name}
                onSessionExpired={onSessionExpired}
              />
            )}
          </div>
        </div>

        {!search.active && refreshError && (
          <p
            role="alert"
            title={t(refreshError.message)}
            className="max-w-xs text-xs text-destructive"
          >
            {t('Issue refresh failed. Please retry.')}
            {refreshError.status === 429 && ` ${t(refreshError.message)}`}
          </p>
        )}
      </header>

      {/* Read-only repositories do not offer write controls */}
      {!canWrite && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            'Writing requires repository push access and App Issues write permission. Check access in GitHub.',
          )}
        </p>
      )}

      {/* Repository-wide search and status/label filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-40 flex-1 items-center gap-2"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            const text = searchInput.current?.value.trim() ?? ''
            if (text === searchText.trim() && search.active)
              void refreshSearch()
            else updateSearch('q', text)
          }}
        >
          <input
            key={searchText}
            ref={searchInput}
            type="search"
            aria-label={t('Search all repository issues')}
            placeholder={t('Search title, body and comments…')}
            maxLength={256}
            defaultValue={searchText}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            variant="outline"
            aria-label={t('Search all repository issues')}
            title={t('Search all repository issues')}
            className="size-8 shrink-0 p-0"
          >
            <svg
              aria-hidden="true"
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
          </Button>
        </form>
        {searchText && (
          <Button
            variant="outline"
            className="h-8 text-xs"
            onClick={() => updateSearch('q', '')}
          >
            {t('Clear search')}
          </Button>
        )}

        <Select
          value={searchStatus}
          onValueChange={(value) => updateSearch('status', value)}
        >
          <SelectTrigger
            aria-label={t('Filter by status')}
            className="h-8 w-36 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All statuses')}</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {t(group.title)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Existing repository labels are searched locally, without changing GitHub labels */}
        <Select
          open={labelsOpen}
          onOpenChange={setLabelsOpen}
          value={searchLabel ? `label:${searchLabel}` : 'all'}
          onValueChange={(value) =>
            updateSearch('label', value === 'all' ? '' : value.slice(6))
          }
        >
          <SelectTrigger
            aria-label={t('Filter by label')}
            className="h-8 w-36 text-xs"
          >
            <SelectValue>{searchLabel || t('All labels')}</SelectValue>
          </SelectTrigger>
          <SelectContent className="w-64">
            <input
              ref={labelInput}
              aria-label={t('Search labels')}
              placeholder={t('Search labels')}
              value={labelText}
              onChange={(event) => setLabelText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') return
                event.stopPropagation()
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLElement>('[role="option"]')
                    ?.focus()
                }
              }}
              className="h-8 w-full rounded border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 max-h-56 overflow-y-auto">
              <SelectItem value="all">{t('All labels')}</SelectItem>
              {search.labels.isPending && (
                <p role="status" className="p-2 text-xs">
                  {t(
                    search.labels.isPaused
                      ? 'Waiting for a connection…'
                      : 'Loading…',
                  )}
                </p>
              )}
              {search.labels.isError && (
                <div role="alert" className="p-2 text-xs text-destructive">
                  <p>{t(search.labels.error.message)}</p>
                  <Button
                    variant="outline"
                    className="mt-2 h-8 text-xs"
                    disabled={
                      search.labels.isFetching || search.labels.isPaused
                    }
                    onClick={() => void search.labels.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              )}
              {search.labels.data?.labels
                .filter(
                  (label) =>
                    !groups.some(
                      (status) =>
                        status.state === 'open' &&
                        status.label?.toLowerCase() ===
                          label.name.toLowerCase(),
                    ),
                )
                .filter((label) =>
                  label.name
                    .toLowerCase()
                    .includes(labelText.trim().toLowerCase()),
                )
                .map((label) => (
                  <SelectItem
                    key={label.id}
                    value={`label:${label.name}`}
                    textValue={label.name}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                      <span className="truncate">{label.name}</span>
                    </span>
                  </SelectItem>
                ))}
              {search.labels.data &&
                !search.labels.data.labels.some((label) =>
                  label.name
                    .toLowerCase()
                    .includes(labelText.trim().toLowerCase()),
                ) && (
                  <p className="p-2 text-xs text-muted-foreground">
                    {t('No labels found.')}
                  </p>
                )}
            </div>
          </SelectContent>
        </Select>

        {(searchText.trim() || searchStatus !== 'all' || searchLabel) && (
          <Button
            variant="outline"
            className="h-8 text-xs"
            onClick={() => updateSearch('reset', '')}
          >
            {t('Reset filters')}
          </Button>
        )}
      </div>

      {/* List settings and Open loading progress */}
      <section
        aria-labelledby="issues-heading"
        className="mt-4 overflow-hidden rounded-xl border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <h2 id="issues-heading" className="font-semibold">
            {t('Issues')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Grouping is independent of search, filters and sorting */}
            <Button
              type="button"
              variant="outline"
              role="switch"
              aria-checked={groupByStatus}
              className="h-8 border-0 bg-transparent px-2 text-xs shadow-none"
              onClick={() => updateSearch('group', groupByStatus ? 'none' : '')}
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 ${groupByStatus ? 'bg-primary' : 'bg-muted-foreground/40'}`}
              >
                <span
                  className={`size-3 rounded-full bg-background transition-transform ${groupByStatus ? 'translate-x-3' : ''}`}
                />
              </span>
              {t('Group by status')}
            </Button>

            <Select
              value={searchSort}
              onValueChange={(value) => updateSearch('sort', value)}
            >
              <SelectTrigger
                aria-label={t(
                  searchSort === 'title'
                    ? 'Sort loaded issues'
                    : 'Sort all search results',
                )}
                className="h-8 w-48 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">{t('Recently updated')}</SelectItem>
                <SelectItem value="created-desc">
                  {t('Newest created')}
                </SelectItem>
                <SelectItem value="created-asc">
                  {t('Oldest created')}
                </SelectItem>
                <SelectItem value="title">{t('Title A–Z (loaded)')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Every grouped search owns its status query and pagination, regardless of filter type */}
        {search.active && groupByStatus && (
          <>
            {searchFailure?.identity === searchIdentity && (
              <p
                role="alert"
                className="border-t px-4 py-3 text-sm text-destructive"
              >
                {t(searchFailure.error.message)}
              </p>
            )}
            {groups
              .filter(
                (group) => searchStatus === 'all' || group.id === searchStatus,
              )
              .map((group) => (
                <IssueSearchGroup
                  key={group.id}
                  userId={userId}
                  repositoryId={repository.id}
                  group={group}
                  text={searchText.trim()}
                  label={searchLabel}
                  sort={searchSort}
                  expanded={stored.preferences.expandedGroups[group.id]}
                  onToggle={() =>
                    savePreferences({
                      ...stored.preferences,
                      expandedGroups: {
                        ...stored.preferences.expandedGroups,
                        [group.id]:
                          !stored.preferences.expandedGroups[group.id],
                      },
                    })
                  }
                  onSessionExpired={onSessionExpired}
                  cachedIssues={
                    group.state === 'open' &&
                    openCacheComplete &&
                    !searchText.trim()
                      ? issues.filter(
                          (issue) =>
                            !searchLabel ||
                            issue.labels.some(
                              (label) =>
                                label.name.toLowerCase() ===
                                searchLabel.toLowerCase(),
                            ),
                        )
                      : null
                  }
                />
              ))}
          </>
        )}

        {/* Flat search keeps one globally ordered result list and cursor */}
        {search.active && !groupByStatus && (
          <div aria-busy={search.isFetching || search.isRefreshing}>
            {/* Complete Open cache can supply this exact status while its first search page loads */}
            {!showingCachedOpen && !search.data && !search.isError ? (
              <p
                role="status"
                className="border-t px-4 py-8 text-sm text-muted-foreground"
              >
                {t(
                  search.isPaused
                    ? 'Waiting for a connection…'
                    : 'Searching issues…',
                )}
              </p>
            ) : (
              <>
                {(search.data || showingCachedOpen) && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="border-t px-4 py-3 text-xs text-muted-foreground"
                  >
                    {showingCachedOpen ? (
                      <>
                        {t('{{count}} loaded', { count: searchIssues.length })}
                        {search.isFetching && ` · ${t('Refreshing…')}`}
                      </>
                    ) : (
                      t(
                        searchIncomplete
                          ? '{{loaded}} loaded · GitHub reports {{total}} matches so far; results incomplete'
                          : '{{loaded}} loaded · {{total}} matches reported by GitHub',
                        { loaded: searchIssues.length, total: searchTotal },
                      )
                    )}
                    {search.data &&
                      search.isRefetching &&
                      ` · ${t('Refreshing…')}`}
                  </p>
                )}
                {searchLimited && (
                  <p role="status" className="px-4 py-3 text-xs text-amber-300">
                    {t(
                      'GitHub Search returns only the first 1,000 matches. Narrow the search to see other results.',
                    )}
                  </p>
                )}
                {searchIncomplete && (
                  <p role="status" className="px-4 py-3 text-xs text-amber-300">
                    {t(
                      'GitHub returned incomplete search results. Counts and pages may be partial; refresh to retry.',
                    )}
                  </p>
                )}
                {searchError && (
                  <div
                    role="alert"
                    className="border-t px-4 py-3 text-sm text-destructive"
                  >
                    {t(searchError.message)}
                  </div>
                )}
                {search.isPaused && (
                  <p
                    role="status"
                    className="px-4 py-3 text-xs text-muted-foreground"
                  >
                    {t('Waiting for a connection…')}
                  </p>
                )}
                {search.data &&
                  searchTotal === 0 &&
                  searchIssues.length === 0 &&
                  !searchError &&
                  !searchIncomplete && (
                    <p className="border-t px-4 py-8 text-sm text-muted-foreground">
                      {t('No matching issues found.')}
                    </p>
                  )}

                {/* Only flat mode uses shared pagination beneath the complete list */}
                <ul aria-label={t('Search results')}>
                  {searchIssues.map((issue) => (
                    <IssueRow key={issue.id} issue={issue} />
                  ))}
                </ul>
                {searchPagination}
              </>
            )}
          </div>
        )}

        {/* The original grouped list resumes when search and filters are cleared */}
        {!search.active && (
          <>
            {!open.data && !open.isError && (
              <div
                role="status"
                className="flex min-h-72 flex-col items-center justify-center gap-4 border-t"
              >
                <span
                  aria-hidden="true"
                  className="relative block h-0.5 w-12 overflow-hidden rounded-full bg-foreground/10"
                >
                  <span className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-foreground/50 motion-safe:animate-[issuel-loading_1.6s_ease-in-out_infinite]" />
                </span>
                <p className="text-xs text-muted-foreground">
                  {t(
                    open.isPaused
                      ? 'Waiting for a connection…'
                      : 'Loading issues…',
                  )}
                </p>
              </div>
            )}
            {open.data && (
              <div
                className="border-t px-4 py-3 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {t(
                  openComplete
                    ? '{{count}} Open issues · All pages loaded'
                    : open.isError
                      ? '{{count}} Open issues retained · Incomplete results'
                      : open.isPaused
                        ? '{{count}} Open issues loaded · Offline; loading paused, results incomplete'
                        : 'Loading Open issues… {{count}} loaded · Counts are partial',
                  { count: openCount },
                )}
                {openConflictCount > 0 &&
                  t(' · {{count}} with mapping conflicts', {
                    count: openConflictCount,
                  })}
              </div>
            )}
            {open.isError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"
              >
                <p className="text-destructive">
                  {t(open.error.message)} {t('The Open list is incomplete.')}
                </p>
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={listRefreshing || open.isFetching || open.isPaused}
                  onClick={() =>
                    void (open.data
                      ? open.fetchNextPage({ cancelRefetch: false })
                      : open.refetch())
                  }
                >
                  {t(open.isFetching ? 'Retrying…' : 'Retry failed page')}
                </Button>
              </div>
            )}

            {/* Conflicting issues remain visible without selecting a status for them */}
            {open.data && conflicts.length > 0 && (
              <aside
                aria-label={t('Mapping conflicts')}
                className="border-t border-amber-400/30 bg-amber-400/5"
              >
                <p className="px-4 py-3 text-xs text-amber-300">
                  {t(
                    'Mapping conflicts · {{count}} loaded · Resolve labels on GitHub; these issues are excluded from the status groups.',
                    { count: conflicts.length },
                  )}
                </p>
                <ul>
                  {conflicts.map(({ issue }) => (
                    <IssueRow key={issue.id} issue={issue} />
                  ))}
                </ul>
              </aside>
            )}

            {/* Status groups appear together with real data, without assumed row counts */}
            {open.data &&
              groups.map((group) => {
                const closedGroup = group.state === 'closed'
                const query =
                  group.id === 'done'
                    ? done
                    : group.id === 'canceled'
                      ? canceled
                      : group.id === 'duplicate'
                        ? duplicate
                        : open
                const waitingForOpen =
                  !closedGroup &&
                  searchSort !== 'updated' &&
                  searchSort !== 'title' &&
                  !openCacheComplete
                const items = closedGroup
                  ? [
                      ...new Map(
                        (query.data?.pages ?? [])
                          .flatMap((page) => page.issues)
                          .map((issue) => [issue.id, issue]),
                      ).values(),
                    ]
                      .sort(compareIssues)
                      .map((issue) => ({ issue }))
                  : waitingForOpen
                    ? []
                    : mapped.filter((item) => item.status === group.id)
                const expanded = stored.preferences.expandedGroups[group.id]
                const searchLimited =
                  query.data?.pages.some((page) => page.searchLimited) ?? false
                const searchPending =
                  query.data?.pages.some((page) => page.searchPending) ?? false
                const complete =
                  !!query.data &&
                  !query.hasNextPage &&
                  !query.isError &&
                  !searchPending &&
                  !searchLimited
                return (
                  <section
                    key={group.id}
                    aria-labelledby={`${group.id}-heading`}
                    className="border-t"
                  >
                    <h3 id={`${group.id}-heading`}>
                      <Button
                        variant="outline"
                        aria-expanded={expanded}
                        aria-controls={`${group.id}-issues`}
                        className="h-auto w-full justify-start rounded-none border-0 bg-muted/30 px-4 py-3 text-xs shadow-none"
                        onClick={() =>
                          savePreferences({
                            ...stored.preferences,
                            expandedGroups: {
                              ...stored.preferences.expandedGroups,
                              [group.id]: !expanded,
                            },
                          })
                        }
                      >
                        <span
                          aria-hidden="true"
                          className="w-2 text-muted-foreground"
                        >
                          {expanded ? '▾' : '▸'}
                        </span>
                        <StatusIcon status={group.id} />
                        <span>{t(group.title)}</span>
                        <span className="font-normal text-muted-foreground">
                          {waitingForOpen
                            ? '—'
                            : !query.data
                              ? closedGroup &&
                                !query.isFetching &&
                                !query.isError
                                ? t('Not loaded')
                                : '—'
                              : complete
                                ? items.length
                                : t('{{count}} loaded', {
                                    count: items.length,
                                  })}
                        </span>
                        {closedGroup && (query.isError || searchLimited) && (
                          <span className="ml-auto text-destructive">
                            {t('Incomplete')}
                          </span>
                        )}
                      </Button>
                    </h3>
                    {expanded && (
                      <div
                        id={`${group.id}-issues`}
                        aria-busy={query.isFetching}
                      >
                        {/* Partial groups wait for correctly ordered data instead of showing old rows */}
                        {((closedGroup && !query.data) || waitingForOpen) &&
                          query.isFetching && (
                            <div
                              role="status"
                              className="flex h-11 items-center gap-2 border-t px-4 sm:gap-3"
                            >
                              <span className="sr-only">
                                {t('Loading {{status}} issues…', {
                                  status: t(group.title),
                                })}
                              </span>
                              <Skeleton className="size-4 shrink-0 rounded-full" />
                              <Skeleton className="hidden h-3 w-12 shrink-0 sm:block" />
                              <Skeleton className="h-3 w-1/3" />
                              <span className="ml-auto text-xs text-muted-foreground">
                                {t('Loading…')}
                              </span>
                            </div>
                          )}

                        <ul
                          aria-label={t('{{status}} issues', {
                            status: t(group.title),
                          })}
                        >
                          {items.map(({ issue }) => (
                            <IssueRow key={issue.id} issue={issue} />
                          ))}
                        </ul>
                        {items.length === 0 &&
                          !!query.data &&
                          !waitingForOpen && (
                            <p className="border-t px-4 py-5 text-xs text-muted-foreground">
                              {t(
                                complete
                                  ? 'No issues in this group.'
                                  : 'No matching issues loaded yet.',
                              )}
                            </p>
                          )}

                        {/* Only this Closed group's query advances when its pagination row is clicked */}
                        {closedGroup && (
                          <>
                            {searchPending && (
                              <p
                                role="status"
                                className="border-t px-4 py-3 text-xs text-muted-foreground"
                              >
                                {t(
                                  'GitHub search is catching up. Confirmed changes are retained; refresh later to revalidate this group.',
                                )}
                              </p>
                            )}

                            {searchLimited && (
                              <p
                                role="status"
                                className="border-t px-4 py-3 text-xs text-amber-300"
                              >
                                {t(
                                  'GitHub Search provides at most 1,000 results. This group is incomplete; counts show only loaded issues.',
                                )}
                              </p>
                            )}
                            {(query.isError || query.isPaused) && (
                              <p
                                role={query.isError ? 'alert' : 'status'}
                                className="border-t px-4 py-3 text-xs text-muted-foreground"
                              >
                                {query.isError
                                  ? `${t(query.error.message)} ${t('Closed results are incomplete.')}`
                                  : t(
                                      'Offline; loading paused. Closed results are incomplete.',
                                    )}
                              </p>
                            )}
                            {(query.isError || query.hasNextPage) && (
                              <Button
                                variant="outline"
                                aria-label={t('Load more {{status}} issues', {
                                  status: t(group.title),
                                })}
                                className="h-11 w-full rounded-none border-x-0 border-b-0 text-xs text-muted-foreground shadow-none"
                                disabled={
                                  listRefreshing ||
                                  query.isFetching ||
                                  query.isPaused
                                }
                                onClick={() =>
                                  void (query.data
                                    ? query.fetchNextPage({
                                        cancelRefetch: false,
                                      })
                                    : query.refetch())
                                }
                              >
                                {t(
                                  query.isPaused
                                    ? 'Waiting for a connection…'
                                    : query.isFetching
                                      ? 'Loading…'
                                      : query.isError
                                        ? 'Retry failed page'
                                        : 'Load more…',
                                )}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
          </>
        )}
      </section>

      {/* Non-blocking browser preference failures */}
      {stored.unavailable && (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          {t(
            'Browser preferences could not be read or saved. Preferences remain available for this visit.',
          )}
        </p>
      )}
    </TooltipProvider>
  )
}
