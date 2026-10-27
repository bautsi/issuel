import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusIcon } from '@/components/workspace'
import { IssueMarkdown } from '@/components/issue-markdown'
import { MarkdownEditor } from '@/components/markdown-editor'
import { defaultStatuses, getIssueStatus, IssueReadError } from '@/lib/issues'
import { useIssueDetail } from '@/lib/use-issue-detail'
import { useIssueComment, useIssueWrite } from '@/lib/use-issue-write'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'
import type { IssueStatus } from '@/lib/issues'

/** Read GitHub content, edit descriptions locally and submit metadata or comments through confirmed writes. */
export function IssueDetail({
  userId, repository, number, onSessionExpired,
}: {
  userId: string
  repository: {
    id: number | null; full_name: string; owner: string; name: string
    permissions: Record<string, boolean>
    installations: { permissions: Record<string, string> }[]
  }
  number: number
  onSessionExpired: () => void
}) {
  const { t, i18n } = useTranslation()
  const [selector, setSelector] = useState<'labels' | 'assignees' | null>(null)
  const selectorRef = useRef<HTMLDivElement>(null)
  const [metadataDrafts, setMetadataDrafts] = useState({
    labels: new Map<string, boolean>(), assignees: new Map<string, boolean>(),
  })
  const [savingMetadata, setSavingMetadata] = useState(false)
  const metadataSubmitting = useRef(false)
  const [search, setSearch] = useState('')
  const [draftComment, setDraftComment] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState<{ original: string; value: string } | null>(null)
  useUnsavedChanges(!!draftComment || (descriptionDraft !== null && descriptionDraft.value !== descriptionDraft.original))
  const { detail, comments, options } = useIssueDetail(userId, repository.id, number, selector)
  const write = useIssueWrite(userId, repository.id, number)
  const commentWrite = useIssueComment(userId, repository.id, number)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [targetStatus, setTargetStatus] = useState<IssueStatus | ''>('')
  const [duplicateNumber, setDuplicateNumber] = useState('')
  const cancelingTitle = useRef(false)
  const canWrite = repository.permissions.push && repository.installations.some(
    (installation) => installation.permissions.issues === 'write',
  ) && !(write.error instanceof IssueReadError && write.error.status === 403)
  const workspacePath = `/workspace/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [])
  useEffect(() => {
    if ([detail.error, comments.error, options.error, write.error, commentWrite.error].some(
      (error) => error instanceof IssueReadError && error.status === 401,
    )) onSessionExpired()
  }, [detail.error, comments.error, options.error, write.error, commentWrite.error, onSessionExpired])

  useEffect(() => {
    if (selector === null) return

    /** Dismiss outside interactions while preserving clicks inside the card and its trigger. */
    function closeSelector(event: PointerEvent) {
      if (metadataSubmitting.current) return
      if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) setSelector(null)
    }

    document.addEventListener('pointerdown', closeSelector, true)
    return () => document.removeEventListener('pointerdown', closeSelector, true)
  }, [selector])

  /** Show precise local dates while keeping the original GitHub timestamps in markup. */
  function date(value: string) {
    return new Date(value).toLocaleString(i18n.resolvedLanguage)
  }

  const issue = detail.data
  const mapped = issue ? getIssueStatus(issue) : null
  const metadataChanges = {
    labels: [...metadataDrafts.labels].filter(([name, selected]) => selected !==
      !!mapped?.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())),
    assignees: [...metadataDrafts.assignees].filter(([login, selected]) => selected !==
      !!issue?.assignees.some((user) => user.login.toLowerCase() === login.toLowerCase())),
  }
  // Keep current assignees removable even when GitHub no longer offers them for assignment.
  const assigneeOptions = [
    ...(options.data?.assignees ?? []),
    ...(issue?.assignees ?? []).filter((user) => !options.data?.assignees.some((option) => option.id === user.id)),
  ]
  const statusName = mapped?.status === 'conflict'
    ? 'Mapping conflict'
    : defaultStatuses.find((status) => status.id === mapped?.status)?.title
  const activity = [...new Map(
    (comments.data?.pages ?? []).flatMap((page) => page.comments).map((comment) => [comment.id, comment]),
  ).values()].sort((a, b) => a.id - b.id)

  /** Start from the accepted title without changing the remote issue until submission. */
  function editTitle() {
    if (!issue || !canWrite || write.isPending || metadataSubmitting.current) return
    cancelingTitle.current = false
    setDraftTitle(issue.title)
    setEditingTitle(true)
    write.reset()
  }

  /** Cancel explicitly before blur can submit the discarded draft. */
  function cancelTitle() {
    cancelingTitle.current = true
    setEditingTitle(false)
    if (!(write.error instanceof IssueReadError && write.error.status === 403)) write.reset()
  }

  /** Share Enter, Save and external blur through the same immediate mutation lock. */
  async function saveTitle() {
    if (!issue || cancelingTitle.current || !editingTitle || !draftTitle.trim() || !canWrite || write.isPending || metadataSubmitting.current) return
    if (draftTitle.trim() === issue.title) { setEditingTitle(false); return }
    try {
      const saved = await write.submit({ title: draftTitle })
      if (saved) setEditingTitle(false)
    } catch { /* Keep the draft editable with retry and cancel actions. */ }
  }

  /** Save a selected status immediately, requiring a valid target before confirming Duplicate. */
  async function saveStatus(status: IssueStatus) {
    if (!canWrite || editingTitle || write.isPending || metadataSubmitting.current) return
    if (status === 'duplicate' &&
      (!/^[1-9]\d*$/.test(duplicateNumber) || !Number.isSafeInteger(Number(duplicateNumber)) || Number(duplicateNumber) === number)) return
    try {
      const saved = await write.submit(status === 'duplicate'
        ? { status, duplicateNumber: Number(duplicateNumber) }
        : { status })
      if (saved) { setTargetStatus(''); setDuplicateNumber('') }
    } catch { /* Retain the accepted remote status and any duplicate target for correction. */ }
  }

  /** Keep explicit selections locally until confirmation, including across ordinary card dismissal. */
  function changeMetadata(kind: 'labels' | 'assignees', value: string, selected: boolean) {
    if (!canWrite || metadataSubmitting.current || write.isPending || commentWrite.isPending) return
    setMetadataDrafts((drafts) => ({ ...drafts, [kind]: new Map(drafts[kind]).set(value, selected) }))
  }

  /** Discard only this card's unsubmitted choices; accepted GitHub changes remain authoritative. */
  function cancelMetadata(kind: 'labels' | 'assignees') {
    if (metadataSubmitting.current) return
    setMetadataDrafts((drafts) => ({ ...drafts, [kind]: new Map<string, boolean>() }))
    if (!(write.error instanceof IssueReadError && write.error.status === 403)) write.reset()
    setSelector(null)
  }

  /** Confirm changed items sequentially, freeing assignee slots first and retaining drafts on failure. */
  async function saveMetadata(kind: 'labels' | 'assignees') {
    if (!issue || !canWrite || metadataSubmitting.current || write.isPending || commentWrite.isPending || editingTitle || detail.isFetching) return
    const changes = metadataChanges[kind].sort(([, left], [, right]) => Number(left) - Number(right))
    if (!changes.length) return
    metadataSubmitting.current = true
    setSavingMetadata(true)
    try {
      let accepted = issue
      for (const [value, selected] of changes) {
        const present = kind === 'labels'
          ? getIssueStatus(accepted).labels.some((label) => label.name.toLowerCase() === value.toLowerCase())
          : accepted.assignees.some((user) => user.login.toLowerCase() === value.toLowerCase())
        if (present === selected) continue
        const saved = await write.submit(kind === 'labels'
          ? { label: value, remove: !selected }
          : { assignee: value, remove: !selected })
        if (!saved) return
        accepted = saved
      }
      setMetadataDrafts((drafts) => ({ ...drafts, [kind]: new Map<string, boolean>() }))
      setSelector(null)
    } catch { /* Keep all intended selections; accepted items are excluded from the next confirmation. */ }
    finally {
      metadataSubmitting.current = false
      setSavingMetadata(false)
    }
  }

  /** Clear only confirmed comments and preserve the complete Markdown draft on failed or uncertain outcomes. */
  async function saveComment() {
    if (!canWrite || commentWrite.isPending || write.isPending || metadataSubmitting.current || !draftComment.trim()) return
    try {
      if (await commentWrite.submit(draftComment)) {
        setDraftComment('')
      }
    } catch { /* Keep the exact draft so the user can check GitHub before deciding to resubmit. */ }
  }

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

            {/* One persistent field keeps text layout identical before and during editing */}
            <h1 className="sr-only">{issue.title}</h1>
            <form aria-label={t('Edit title')} aria-busy={write.isPending} className="flex items-start gap-2"
              onSubmit={(event) => { event.preventDefault(); void saveTitle() }}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void saveTitle() }}>
              <textarea aria-label={t('Title')} rows={1} required
                value={editingTitle ? draftTitle : issue.title} readOnly={!editingTitle || !canWrite} disabled={write.isPending || savingMetadata}
                onFocus={() => { if (!editingTitle && !detail.isFetching) editTitle() }}
                onClick={() => { if (!editingTitle && !detail.isFetching) editTitle() }}
                onChange={(event) => setDraftTitle(event.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (editingTitle) void saveTitle()
                    else if (!detail.isFetching) editTitle()
                  }
                  if (event.key === 'Escape' && editingTitle) { event.preventDefault(); cancelTitle() }
                }}
                className={`block min-h-[calc(1.375em_+_0.5rem)] min-w-0 flex-1 resize-none overflow-hidden rounded-sm border-0 bg-transparent px-0 py-1 text-xl leading-snug font-semibold tracking-tight outline-none [field-sizing:content] sm:text-2xl ${editingTitle ? 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring' : canWrite ? 'cursor-pointer hover:bg-muted/30' : ''}`} />

              {/* Reserve action width in both modes so showing controls cannot rewrap the title */}
              <div aria-hidden={!editingTitle} className={`flex shrink-0 gap-1 pt-1 ${editingTitle ? '' : 'invisible'}`}>
                <Button type="submit" variant="outline" className="size-8 p-0"
                  aria-label={t(write.isPending ? 'Saving…' : 'Save')} title={t('Save')}
                  disabled={!editingTitle || !draftTitle.trim() || write.isPending || !canWrite}>
                  <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
                </Button>
                <Button type="button" variant="outline" className="size-8 p-0"
                  aria-label={t('Cancel')} title={t('Cancel')} disabled={!editingTitle || write.isPending} onClick={cancelTitle}>
                  <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
                </Button>
              </div>
            </form>

            {/* Feedback is shared by title and status writes */}
            {write.error && <p role="alert" className="mt-3 text-xs text-destructive">{t(write.error.message)}</p>}
            {(savingMetadata || write.isPending || write.isSuccess) && <p role="status" className="mt-3 text-xs text-muted-foreground">{t(savingMetadata || write.isPending ? 'Saving…' : 'Saved to GitHub.')}</p>}
            {!canWrite && <p className="mt-3 text-xs text-muted-foreground">{t('Writing requires repository push access and App Issues write permission. Check access in GitHub.')}</p>}
            <p role="status" className="mt-3 text-[11px] text-muted-foreground">
              {t(detail.isFetching || !detail.isFetchedAfterMount
                ? 'Checking latest GitHub content… Cached content may be shown.'
                : 'Checked GitHub at {{date}}', { date: date(new Date(detail.dataUpdatedAt).toISOString()) })}
            </p>
            {mapped?.status === 'conflict' && (
              <p className="mt-3 text-xs text-amber-300">{t('Status mapping needs attention. GitHub state and reason are shown in properties.')}</p>
            )}

            {/* Description edits stay local until the safe persistence workflow is implemented. */}
            <section aria-label={t('Description')} className="mt-8 min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium text-muted-foreground">{t('Description')}</h2>
                {canWrite && descriptionDraft === null && <Button type="button" variant="outline" className="h-7 text-xs"
                  onClick={() => setDescriptionDraft({ original: issue.body ?? '', value: issue.body ?? '' })}>{t('Edit locally')}</Button>}
              </div>
              {descriptionDraft !== null ? (
                <div className="space-y-3">
                  <p role="status" className="text-xs text-amber-300">{t('Local editing only. Changes are not saved to GitHub and will be lost when you leave.')}</p>
                  <MarkdownEditor value={descriptionDraft.value}
                    onChange={(value) => setDescriptionDraft({ ...descriptionDraft, value })} label={t('Description')}
                    fullName={issue.full_name} defaultBranch={issue.default_branch} githubUrl={issue.html_url} readOnly={!canWrite} />
                  <Button type="button" variant="outline" className="h-7 text-xs" onClick={() => {
                    if (descriptionDraft.value !== descriptionDraft.original && !window.confirm(t('Discard local description changes?'))) return
                    setDescriptionDraft(null)
                  }}>{t('Close local editor')}</Button>
                </div>
              ) : issue.body?.trim() ? (
                <IssueMarkdown body={issue.body} fullName={issue.full_name} defaultBranch={issue.default_branch} githubUrl={issue.html_url} />
              ) : <p className="text-sm text-muted-foreground">{t('No description provided.')}</p>}
            </section>

            {/* Comments have their own loading, error, empty and pagination states */}
            <section aria-labelledby="activity-heading" className="mt-12 border-t pt-6">
              <h2 id="activity-heading" className="text-sm font-semibold">{t('Activity')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('GitHub comments · {{count}} total', { count: issue.comments })}</p>
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

              {/* Markdown composer submits once and retains failed drafts */}
              {canWrite && (
                <form className="mt-7 space-y-3" aria-busy={commentWrite.isPending}
                  onSubmit={(event) => { event.preventDefault(); void saveComment() }}>
                  <p className="text-xs font-medium">{t('Add a comment')}</p>

                  {/* Both modes preserve the same Markdown draft until explicit submission. */}
                  <MarkdownEditor value={draftComment} onChange={setDraftComment} label={t('Add a comment')}
                    fullName={issue.full_name} defaultBranch={issue.default_branch} githubUrl={issue.html_url}
                    disabled={commentWrite.isPending} />

                  {/* Submission uses the same Markdown from either tab */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{t('Markdown and GFM supported.')}</span>
                    <Button type="submit" className="h-8 text-xs" disabled={
                      commentWrite.isPending || write.isPending || savingMetadata || editingTitle || !draftComment.trim() || !comments.data?.pages.length
                    }>{t(commentWrite.isPending ? 'Submitting…' : 'Submit comment')}</Button>
                  </div>
                  {!comments.data?.pages.length && <p className="text-xs text-muted-foreground">{t('Load comments before submitting.')}</p>}
                  {commentWrite.error && <p role="alert" className="text-xs text-destructive">{t(commentWrite.error.message)}</p>}
                  {commentWrite.isSuccess && <p role="status" className="text-xs text-muted-foreground">{t('Comment posted to GitHub.')}</p>}
                </form>
              )}
            </section>
          </article>

          {/* Issue properties retain separate status and ordinary metadata controls */}
          <aside aria-label={t('Properties')} className="min-w-0 border-t pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
            <h2 className="mb-5 text-xs font-semibold">{t('Properties')}</h2>
            <dl className="space-y-5 text-xs">
              {/* The current status directly opens its available transitions */}
              <div><dt className="mb-2 text-muted-foreground">{t('Status')}</dt><dd>
                {canWrite ? (
                  <Select value={mapped?.status ?? ''} disabled={write.isPending || savingMetadata || editingTitle || detail.isFetching}
                    onValueChange={(value) => {
                      write.reset()
                      setDuplicateNumber('')
                      if (value === 'duplicate') setTargetStatus('duplicate')
                      else { setTargetStatus(''); void saveStatus(value as IssueStatus) }
                    }}>
                    <SelectTrigger aria-label={t(issue.state === 'closed' ? 'Reopen as' : 'Change status')}
                      className="h-8 w-full text-xs">
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          {mapped && <StatusIcon status={mapped.status} />}
                          {t(write.isPending ? 'Saving…' : statusName ?? 'Mapping conflict')}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {defaultStatuses.filter((status) => issue.state === 'open' || status.state === 'open').map((status) => (
                        <SelectItem key={status.id} value={status.id} className="text-xs" disabled={
                          status.id === mapped?.status || (mapped?.status === 'conflict' && status.state === 'open')
                        }>
                          <span className="flex items-center gap-2"><StatusIcon status={status.id} />{t(status.title)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : <span className="flex items-center gap-2">{mapped && <StatusIcon status={mapped.status} />}{t(statusName ?? 'Mapping conflict')}</span>}

                {/* Duplicate references use an Issue Number here and an Issue ID at GitHub */}
                {canWrite && targetStatus === 'duplicate' && (
                  <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void saveStatus('duplicate') }}>
                    <label className="block">{t('Original issue number')}
                      <input autoFocus required inputMode="numeric" pattern="[1-9][0-9]*" value={duplicateNumber}
                        disabled={write.isPending} onChange={(event) => setDuplicateNumber(event.target.value)}
                        className="mt-2 w-full rounded-md border bg-background px-2 py-2" />
                    </label>
                    <div className="flex gap-2">
                      <Button type="submit" className="h-8 flex-1 text-xs" disabled={
                        write.isPending || editingTitle || detail.isFetching || !/^[1-9]\d*$/.test(duplicateNumber) ||
                        !Number.isSafeInteger(Number(duplicateNumber)) || Number(duplicateNumber) === number
                      }>{t(write.isPending ? 'Saving…' : 'Save')}</Button>
                      <Button type="button" variant="outline" className="h-8 text-xs" disabled={write.isPending}
                        onClick={() => { setTargetStatus(''); setDuplicateNumber('') }}>{t('Cancel')}</Button>
                    </div>
                  </form>
                )}
                {canWrite && issue.state === 'closed' && <p className="mt-2 leading-5 text-muted-foreground">{t('Reopen this issue before choosing another closed reason.')}</p>}
              </dd></div>

              <div><dt className="mb-2 text-muted-foreground">{t('GitHub state')}</dt><dd>{issue.state}</dd></div>
              <div><dt className="mb-2 text-muted-foreground">{t('State reason')}</dt><dd>{issue.state_reason ?? '—'}</dd></div>
              {/* Searchable multi-selection for repository users and ordinary labels */}
              {(['assignees', 'labels'] as const).map((kind) => (
                <div key={kind} ref={selector === kind ? selectorRef : null} className="relative"><dt className="mb-2 text-muted-foreground">{t(kind === 'labels' ? 'Labels' : 'Assignees')}</dt><dd>
                  <button type="button" aria-label={t(kind === 'labels' ? 'Manage labels' : 'Manage assignees')}
                    aria-expanded={selector === kind} aria-controls={`${kind}-selector`} disabled={!canWrite || editingTitle || savingMetadata || write.isPending || commentWrite.isPending}
                    onClick={() => { if (!metadataSubmitting.current) { setSelector(selector === kind ? null : kind); setSearch('') } }}
                    className={`-ml-1 flex min-h-8 w-full items-center rounded-md border p-1 text-left enabled:hover:border-border enabled:hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 ${
                      (kind === 'labels' ? mapped?.labels.length : issue.assignees.length) ? 'border-transparent' : 'border-border'
                    }`}>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {kind === 'labels' ? (mapped?.labels.length ? mapped.labels.map((label) => (
                        <span key={label.id ?? label.name} className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1">
                          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" style={label.color ? { backgroundColor: `#${label.color}` } : undefined} />
                          <span className="break-all">{label.name}</span>
                        </span>
                      )) : <span className="px-1">{t('No labels')}</span>) : (issue.assignees.length ? issue.assignees.map((user) => (
                        <span key={user.id} className="flex items-center gap-2 break-all"><img src={`https://avatars.githubusercontent.com/u/${user.id}?s=48`} alt="" className="size-5 rounded-full" loading="lazy" referrerPolicy="no-referrer" />{user.login}</span>
                      )) : <span className="px-1">{t('Unassigned')}</span>)}
                    </span>
                  </button>

                  {/* Choices remain local until saved; ordinary dismissal preserves both cards' drafts */}
                  {selector === kind && (
                    <fieldset id={`${kind}-selector`} aria-label={t(kind === 'labels' ? 'Manage labels' : 'Manage assignees')}
                      disabled={savingMetadata || write.isPending || commentWrite.isPending} aria-busy={savingMetadata}
                      onKeyDown={(event) => { if (event.key === 'Escape' && !metadataSubmitting.current) setSelector(null) }}
                      className="absolute right-0 z-20 mt-2 w-72 min-w-0 max-w-[85vw] rounded-lg border bg-card p-3 shadow-xl">
                      <div className="mb-3 flex items-center gap-2">
                        <input autoFocus aria-label={t(kind === 'labels' ? 'Search labels' : 'Search assignees')} value={search}
                          onChange={(event) => setSearch(event.target.value)} placeholder={t(kind === 'labels' ? 'Search labels' : 'Search assignees')}
                          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        <button type="button" onClick={() => setSelector(null)} aria-label={t('Close selector')} className="rounded px-2 py-2 hover:bg-accent">×</button>
                      </div>
                      {options.error && <div role="alert" className="space-y-2 py-2 text-destructive"><p>{t(options.error.message)}</p>
                        <Button variant="outline" className="h-7 text-xs" disabled={options.isFetching} onClick={() => void options.refetch()}>{t('Retry')}</Button>
                      </div>}
                      <div className="max-h-56 overflow-y-auto">
                        {kind === 'labels' ? options.data?.labels.filter((label) => label.name.toLowerCase().includes(search.toLowerCase())).map((label) => (
                          <label key={label.id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-accent">
                            <input type="checkbox" checked={metadataDrafts.labels.get(label.name) ?? !!mapped?.labels.some((item) => item.id === label.id || item.name.toLowerCase() === label.name.toLowerCase())}
                              disabled={!canWrite || editingTitle || write.isPending || commentWrite.isPending || detail.isFetching || !!options.error}
                              onChange={(event) => changeMetadata('labels', label.name, event.target.checked)} />
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} /><span className="break-all">{label.name}</span>
                          </label>
                        )) : assigneeOptions.filter((user) => user.login.toLowerCase().includes(search.toLowerCase())).map((user) => (
                          <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-accent">
                            <input type="checkbox" checked={metadataDrafts.assignees.get(user.login) ?? issue.assignees.some((item) => item.id === user.id)}
                              disabled={!canWrite || editingTitle || write.isPending || commentWrite.isPending || detail.isFetching || !!options.error}
                              onChange={(event) => changeMetadata('assignees', user.login, event.target.checked)} />
                            <img src={`https://avatars.githubusercontent.com/u/${user.id}?s=48`} alt="" className="size-5 rounded-full" loading="lazy" referrerPolicy="no-referrer" /><span className="break-all">{user.login}</span>
                          </label>
                        ))}
                        {options.isSuccess && !options.isFetching && !(kind === 'labels' ? options.data.labels.some((label) => label.name.toLowerCase().includes(search.toLowerCase())) : assigneeOptions.some((user) => user.login.toLowerCase().includes(search.toLowerCase()))) &&
                          <p className="py-3 text-muted-foreground">{t(kind === 'labels' ? 'No matching repository labels.' : 'No matching assignable users.')}</p>}

                        {/* Loading stays below the available options without blocking selection */}
                        {options.isFetching && (
                          <div role="status">
                            <div className="flex items-center gap-2 p-2">
                              <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                              <Skeleton className={kind === 'labels' ? 'size-2 shrink-0 rounded-full' : 'size-5 shrink-0 rounded-full'} />
                              <Skeleton className="h-3 w-24" />
                            </div>
                            <span className="sr-only">{t('Loading…')}</span>
                          </div>
                        )}
                      </div>

                      {/* Only Save writes changes; Cancel explicitly discards the current card's draft */}
                      <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                        <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => cancelMetadata(kind)}>{t('Cancel')}</Button>
                        <Button type="button" className="h-8 text-xs" disabled={!canWrite || editingTitle || detail.isFetching || metadataChanges[kind].length === 0}
                          onClick={() => void saveMetadata(kind)}>{t(savingMetadata ? 'Saving…' : 'Save')}</Button>
                      </div>
                      {write.error && <p role="alert" className="mt-2 text-destructive">{t(write.error.message)}</p>}

                      {/* Cover the entire card during saving while retaining its opaque background */}
                      {savingMetadata && <div aria-hidden="true" className="absolute inset-0 z-10 cursor-wait rounded-lg bg-background/60" />}
                    </fieldset>
                  )}
                </dd></div>
              ))}

              {/* Author identity is available on hover or focus without adding another text row */}
              <div><dt className="mb-2 text-muted-foreground">{t('Author')}</dt><dd>
                {issue.author ? (
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a href={`https://github.com/${encodeURIComponent(issue.author.login)}`} target="_blank" rel="noopener noreferrer"
                          aria-label={issue.author.login} className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-ring">
                          <img src={`https://avatars.githubusercontent.com/u/${issue.author.id}?s=64`} alt="" className="size-6 rounded-full" loading="lazy" referrerPolicy="no-referrer" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{issue.author.login}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : t('Deleted user')}
              </dd></div>
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
