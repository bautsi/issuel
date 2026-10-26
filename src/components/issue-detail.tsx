import { useEffect, useLayoutEffect } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusIcon } from '@/components/workspace'
import { IssueMarkdown } from '@/components/issue-markdown'
import { defaultStatuses, getIssueStatus, IssueReadError } from '@/lib/issues'
import { useIssueDetail } from '@/lib/use-issue-detail'

/** Keep issue loading stable until its repository is resolved, then display content and comments. */
export function IssueDetail({
  userId, repository, number, onSessionExpired,
}: {
  userId: string
  repository: { id: number | null; full_name: string; owner: string; name: string }
  number: number
  onSessionExpired: () => void
}) {
  const { t, i18n } = useTranslation()
  const { detail, comments } = useIssueDetail(userId, repository.id, number)
  const workspacePath = `/workspace/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [])
  useEffect(() => {
    if ([detail.error, comments.error].some(
      (error) => error instanceof IssueReadError && error.status === 401,
    )) onSessionExpired()
  }, [detail.error, comments.error, onSessionExpired])

  /** Show precise local dates while keeping the original GitHub timestamps in markup. */
  function date(value: string) {
    return new Date(value).toLocaleString(i18n.resolvedLanguage)
  }

  const issue = detail.data
  const mapped = issue ? getIssueStatus(issue) : null
  const statusName = mapped?.status === 'conflict'
    ? 'Mapping conflict'
    : defaultStatuses.find((status) => status.id === mapped?.status)?.title
  const activity = [...new Map(
    (comments.data?.pages ?? []).flatMap((page) => page.comments).map((comment) => [comment.id, comment]),
  ).values()]

  return (
    <div className="mx-auto max-w-6xl">
      {/* Issue navigation stays available during loading and failures */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-xs text-muted-foreground">
        <Link
          to={workspacePath}
          state={{ userId, repositoryId: repository.id }}
          className="rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          ← {t('Back to issues')}
        </Link>
        <span className="min-w-0 truncate">{repository.full_name} / #{number}</span>
      </header>

      {/* Initial load and protected-read errors */}
      {detail.isPending && (
        <div role="status" aria-busy="true" className="space-y-6">
          <p className="text-xs text-muted-foreground">{t('Loading issue…')}</p>
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {detail.isError && (
        <div role="alert" className="max-w-xl rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">{t('Issue unavailable')}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{t(detail.error.message)}</p>
          {detail.error instanceof IssueReadError && detail.error.retryAt > detail.errorUpdatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">{t('Retry after {{date}}', { date: date(new Date(detail.error.retryAt).toISOString()) })}</p>
          )}
          <Button variant="outline" className="mt-4" disabled={detail.isFetching} onClick={() => void detail.refetch()}>
            {t(detail.isFetching ? 'Loading…' : 'Retry')}
          </Button>
        </div>
      )}

      {/* Main reading column and separate issue properties */}
      {issue && !detail.isError && (
        <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_15rem]">
          <article className="min-w-0">
            {/* Issue identity, mapped status and freshness */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">#{issue.number}</span>
              {mapped && <StatusIcon status={mapped.status} />}
              <span>{t(statusName ?? 'Mapping conflict')}</span>
            </div>
            <h1 className="break-words text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">{issue.title}</h1>
            <p role="status" className="mt-3 text-[11px] text-muted-foreground">
              {t(detail.isFetching || !detail.isFetchedAfterMount
                ? 'Checking latest GitHub content… Cached content may be shown.'
                : 'Checked GitHub at {{date}}', { date: date(new Date(detail.dataUpdatedAt).toISOString()) })}
            </p>
            {mapped?.status === 'conflict' && (
              <p className="mt-3 text-xs text-amber-300">{t('Status mapping needs attention. GitHub state and reason are shown in properties.')}</p>
            )}

            {/* Description retains the remote Markdown without editing it */}
            <section aria-label={t('Description')} className="mt-8 min-w-0">
              {issue.body?.trim() ? (
                <IssueMarkdown body={issue.body} fullName={issue.full_name} defaultBranch={issue.default_branch} githubUrl={issue.html_url} />
              ) : <p className="text-sm text-muted-foreground">{t('No description provided.')}</p>}
            </section>

            {/* Comments have their own loading, error, empty and pagination states */}
            <section aria-labelledby="activity-heading" className="mt-12 border-t pt-6">
              <h2 id="activity-heading" className="text-sm font-semibold">{t('Activity')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('GitHub comments · Read only')}</p>
              {comments.isPending && <p role="status" className="mt-6 text-sm text-muted-foreground">{t('Loading comments…')}</p>}
              {comments.isRefetching && !comments.isFetchingNextPage && (
                <p role="status" className="mt-4 text-xs text-muted-foreground">{t('Checking latest comments… Cached comments may be shown.')}</p>
              )}
              {comments.isError && (
                <div role="alert" className="mt-5 rounded-lg border p-4 text-sm">
                  <p>{t(comments.error.message)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{t('Comments could not be fully loaded. Previously loaded comments may be outdated.')}</p>
                  {comments.error instanceof IssueReadError && comments.error.retryAt > comments.errorUpdatedAt && (
                    <p className="mt-2 text-xs text-muted-foreground">{t('Retry after {{date}}', { date: date(new Date(comments.error.retryAt).toISOString()) })}</p>
                  )}
                  <Button variant="outline" className="mt-3 h-8 text-xs" disabled={comments.isFetching} onClick={() => void (
                    comments.isFetchNextPageError
                      ? comments.fetchNextPage({ cancelRefetch: false })
                      : comments.refetch()
                  )}>{t('Retry comments')}</Button>
                </div>
              )}
              {comments.isSuccess && activity.length === 0 && (
                <p className="mt-6 text-sm text-muted-foreground">{t('No comments yet.')}</p>
              )}
              <ol className="mt-6 space-y-4">
                {activity.map((comment) => (
                  <li key={comment.id} className="min-w-0 rounded-lg border bg-card/60 p-4 sm:p-5" id={`issuecomment-${comment.id}`}>
                    {/* Comment author and timestamps */}
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {comment.author ? (
                        <a href={`https://github.com/${encodeURIComponent(comment.author.login)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-foreground">
                          <img src={`https://avatars.githubusercontent.com/u/${comment.author.id}?s=48`} alt="" className="size-6 rounded-full" loading="lazy" referrerPolicy="no-referrer" />
                          {comment.author.login}
                        </a>
                      ) : <span>{t('Deleted user')}</span>}
                      <a href={comment.html_url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                        <time dateTime={comment.created_at}>{date(comment.created_at)}</time> ↗
                      </a>
                      {comment.updated_at !== comment.created_at && (
                        <span title={date(comment.updated_at)}>{t('Edited {{date}}', { date: date(comment.updated_at) })}</span>
                      )}
                    </div>

                    {/* Comment Markdown body */}
                    {comment.body?.trim() ? (
                      <IssueMarkdown body={comment.body} fullName={issue.full_name} defaultBranch={issue.default_branch} githubUrl={comment.html_url} />
                    ) : <p className="text-sm text-muted-foreground">{t('Empty comment')}</p>}
                  </li>
                ))}
              </ol>
              {comments.hasNextPage && !comments.isError && (
                <Button variant="outline" className="mt-8 w-full text-xs" disabled={comments.isFetching} onClick={() => void comments.fetchNextPage({ cancelRefetch: false })}>
                  {t(comments.isFetchingNextPage ? 'Loading comments…' : 'Load more comments')}
                </Button>
              )}
              {activity.length > 0 && <p className="mt-5 text-xs text-muted-foreground">{t(comments.hasNextPage || comments.isError ? '{{count}} comments loaded · Incomplete' : '{{count}} comments loaded', { count: activity.length })}</p>}
            </section>
          </article>

          {/* Read-only properties remain distinct from the Markdown body */}
          <aside aria-label={t('Properties')} className="min-w-0 border-t pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
            <h2 className="mb-5 text-xs font-semibold">{t('Properties')}</h2>
            <dl className="space-y-5 text-xs">
              <div><dt className="mb-2 text-muted-foreground">{t('Status')}</dt><dd className="flex items-center gap-2">{mapped && <StatusIcon status={mapped.status} />}{t(statusName ?? 'Mapping conflict')}</dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('GitHub state')}</dt><dd>{issue.state}</dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('State reason')}</dt><dd>{issue.state_reason ?? '—'}</dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('Assignees')}</dt><dd className="space-y-2">
                {issue.assignees.length ? issue.assignees.map((user) => <a key={user.id} href={`https://github.com/${encodeURIComponent(user.login)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all hover:underline"><img src={`https://avatars.githubusercontent.com/u/${user.id}?s=48`} alt="" className="size-5 rounded-full" loading="lazy" referrerPolicy="no-referrer" />{user.login}</a>) : t('Unassigned')}
              </dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('Labels')}</dt><dd className="flex flex-wrap gap-1.5">
                {issue.labels.length ? issue.labels.map((label) => <span key={label.id ?? label.name} className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1"><span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" style={label.color ? { backgroundColor: `#${label.color}` } : undefined} /><span className="break-all">{label.name}</span></span>) : t('No labels')}
              </dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('Author')}</dt><dd className="break-all">{issue.author ? <a href={`https://github.com/${encodeURIComponent(issue.author.login)}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{issue.author.login}</a> : t('Deleted user')}</dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('Created')}</dt><dd><time dateTime={issue.created_at}>{date(issue.created_at)}</time></dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('Updated')}</dt><dd><time dateTime={issue.updated_at}>{date(issue.updated_at)}</time></dd></div>
              {issue.closed_at && <div><dt className="mb-2 text-muted-foreground">{t('Closed')}</dt><dd><time dateTime={issue.closed_at}>{date(issue.closed_at)}</time></dd></div>}
            </dl>
            <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="mt-7 inline-block text-xs text-muted-foreground hover:text-foreground">{t('Open in GitHub')} ↗</a>
          </aside>
        </div>
      )}
    </div>
  )
}
