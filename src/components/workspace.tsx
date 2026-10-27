import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  defaultStatuses as groups,
  getIssueStatus,
  IssueReadError,
} from '@/lib/issues'
import type { Issue, IssueStatus } from '@/lib/issues'
import { useIssues } from '@/lib/use-issues'
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

/** Open a repository-scoped detail while keeping compact status and metadata in the list row. */
function IssueRow({ issue }: { issue: Issue }) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const mapped = getIssueStatus(issue)
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
            to={`${location.pathname}/issue/${issue.number}`}
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
          className="pointer-events-none break-words"
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
          <TooltipContent side="bottom" className="break-words">
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

/** Preserve grouped pages and navigation state while offering creation to authorized writers. */
export function Workspace({
  userId,
  repository,
  onSessionExpired,
  scrollPositions,
}: {
  userId: string
  repository: {
    id: number; full_name: string; private: boolean
    permissions: Record<string, boolean>
    installations: { permissions: Record<string, string> }[]
  }
  onSessionExpired: () => void
  scrollPositions: RefObject<Map<number, number>>
}) {
  const { t } = useTranslation()
  useLayoutEffect(() => {
    const positions = scrollPositions.current
    window.scrollTo(0, positions.get(repository.id) ?? 0)
    return () => { positions.set(repository.id, window.scrollY) }
  }, [repository.id, scrollPositions])
  const canWrite = repository.permissions.push && repository.installations.some(
    (installation) => installation.permissions.issues === 'write',
  )
  const [stored, setStored] = useState(() =>
    readWorkspacePreferences(userId, repository.id),
  )
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<IssueReadError | null>(null)
  const refreshPending = useRef(false)
  const open = useIssues(userId, repository.id, 'open', !refreshing)
  const done = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing && !!open.data && stored.preferences.expandedGroups.done,
    'done',
  )
  const canceled = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing && !!open.data && stored.preferences.expandedGroups.canceled,
    'canceled',
  )
  const duplicate = useIssues(
    userId,
    repository.id,
    'closed',
    !refreshing && !!open.data && stored.preferences.expandedGroups.duplicate,
    'duplicate',
  )

  useEffect(() => {
    if (
      [open.error, done.error, canceled.error, duplicate.error].some(
        (error) => error instanceof IssueReadError && error.status === 401,
      )
    ) {
      onSessionExpired()
    }
  }, [
    open.error,
    done.error,
    canceled.error,
    duplicate.error,
    onSessionExpired,
  ])

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
      const results = await Promise.allSettled(
        [
          open,
          ...([
            ['done', done],
            ['canceled', canceled],
            ['duplicate', duplicate],
          ] as const)
            .filter(
              ([id, query]) => stored.preferences.expandedGroups[id] && query.data,
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

  /** Apply the same workspace ordering without combining the independent Closed datasets. */
  function compareIssues(a: Issue, b: Issue) {
    if (stored.preferences.sort === 'title')
      return a.title.localeCompare(b.title) || b.number - a.number
    const field =
      stored.preferences.sort === 'created' ? 'created_at' : 'updated_at'
    return Date.parse(b[field]) - Date.parse(a[field]) || b.number - a.number
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
    status: getIssueStatus(issue).status,
  }))
  const conflicts = mapped.filter((item) => item.status === 'conflict')
  const openConflictCount = conflicts.filter(
    (item) => item.issue.state === 'open',
  ).length
  const openCount = issues.filter((issue) => issue.state === 'open').length
  const openComplete = !!open.data && !open.hasNextPage && !open.isError

  return (
    <TooltipProvider delayDuration={300}>
      {/* Workspace identity */}
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">
          {t('REPOSITORY WORKSPACE')}
        </p>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight">
          {repository.full_name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('{{visibility}} repository · GitHub Issues', {
            visibility: t(repository.private ? 'Private' : 'Public'),
          })}
        </p>
      </header>

      {/* Read-only repositories do not offer write controls */}
      {!canWrite && <p className="mt-3 text-xs text-muted-foreground">{t('Writing requires repository push access and App Issues write permission. Check access in GitHub.')}</p>}

      {/* List settings and Open loading progress */}
      <section
        aria-labelledby="issues-heading"
        className="mt-8 overflow-hidden rounded-xl border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <h2 id="issues-heading" className="font-semibold">
            {t('Issues')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Issue creation requires both user and App write access */}
            {canWrite && <NewIssue userId={userId} repositoryId={repository.id} fullName={repository.full_name} onSessionExpired={onSessionExpired} />}

            <Button
              variant="outline"
              aria-label={t(listRefreshing ? 'Refreshing…' : 'Refresh issues')}
              aria-busy={listRefreshing}
              title={t(listRefreshing ? 'Refreshing…' : 'Refresh issues')}
              className="size-8 border-transparent bg-transparent p-0 text-muted-foreground shadow-none"
              disabled={listRefreshing || !open.data || open.isPaused}
              onClick={() => void refreshIssues()}
            >
              <svg
                aria-hidden="true"
                className={`size-3.5 ${listRefreshing ? 'motion-safe:animate-spin' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {listRefreshing ? (
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

            {refreshError && (
              <p
                role="alert"
                title={t(refreshError.message)}
                className="max-w-xs text-xs text-destructive"
              >
                {t('Issue refresh failed. Please retry.')}
                {refreshError.status === 429 && ` ${t(refreshError.message)}`}
              </p>
            )}

            <Select
              value={stored.preferences.sort}
              onValueChange={(value) => {
                if (
                  value === 'updated' ||
                  value === 'created' ||
                  value === 'title'
                )
                  savePreferences({ ...stored.preferences, sort: value })
              }}
            >
              <SelectTrigger
                aria-label={t('Sort loaded issues')}
                className="h-8 w-40 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">{t('Last updated ↓')}</SelectItem>
                <SelectItem value="created">{t('Created date ↓')}</SelectItem>
                <SelectItem value="title">{t('Title A–Z')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

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
                open.isPaused ? 'Waiting for a connection…' : 'Loading issues…',
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
                      {!query.data
                        ? closedGroup && !query.isFetching && !query.isError
                          ? t('Not loaded')
                          : '—'
                        : complete
                          ? items.length
                          : t('{{count}} loaded', { count: items.length })}
                    </span>
                    {closedGroup && (query.isError || searchLimited) && (
                      <span className="ml-auto text-destructive">
                        {t('Incomplete')}
                      </span>
                    )}
                  </Button>
                </h3>
                {expanded && (
                  <div id={`${group.id}-issues`} aria-busy={query.isFetching}>
                    {/* One loading row distinguishes an initial Closed request from empty results */}
                    {closedGroup && !query.data && query.isFetching && (
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
                    {items.length === 0 && !!query.data && (
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
                        {searchPending && <p role="status" className="border-t px-4 py-3 text-xs text-muted-foreground">{t('GitHub search is catching up. Confirmed changes are retained; refresh later to revalidate this group.')}</p>}

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
                              listRefreshing || query.isFetching || query.isPaused
                            }
                            onClick={() =>
                              void (query.data
                                ? query.fetchNextPage({ cancelRefetch: false })
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
