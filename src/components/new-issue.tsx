import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { RepositorySettingsLink } from '@/components/repository-settings'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IssueReadError } from '@/lib/issues'
import { useRepositoryStatuses } from '@/lib/use-repository-config'
import type { IssueStatus } from '@/lib/issues'
import { useIssueWrite } from '@/lib/use-issue-write'
import { MarkdownEditor } from '@/components/markdown-editor'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'
import { useLocalDraft } from '@/lib/use-local-draft'

/** Recover local fields with dialog-contained controls and explicit discard or creation. */
export function NewIssue({
  userId,
  repositoryId,
  fullName,
  onSessionExpired,
}: {
  userId: string
  repositoryId: number
  fullName: string
  onSessionExpired: () => void
}) {
  const { t } = useTranslation()
  const defaultStatuses = useRepositoryStatuses()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)
  const mounted = useRef(true)
  const draft = useLocalDraft(userId, repositoryId)
  const { title, body, status } = draft.value
  const hasDraft = !!title || !!body || status !== 'backlog'
  const write = useIssueWrite(userId, repositoryId)
  const unsavedRef = useUnsavedChanges(
    draft.pending ||
      (!!draft.error && (!!title || !!body || status !== 'backlog')),
  )
  const denied =
    write.error instanceof IssueReadError && write.error.status === 403
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (
      write.error instanceof IssueReadError &&
      write.error.status === 401 &&
      !(draft.error && (title || body))
    )
      onSessionExpired()
  }, [write.error, onSessionExpired, draft.error, title, body])

  /** Clear this local draft before closing, retaining the dialog if persistence fails. */
  async function cancel() {
    if (!draft.ready || draft.clearing || write.isPending) return
    if (!(await draft.clear()) || !mounted.current) return
    unsavedRef.current = false
    dialog?.close()
  }

  /** Preserve the draft until a confirmed result, without automatically retrying an uncertain write. */
  async function create() {
    if (
      !draft.ready ||
      draft.clearing ||
      !title.trim() ||
      write.isPending ||
      denied
    )
      return
    try {
      const issue = await write.submit({ title, body, status })
      if (!issue) return
      if (!(await draft.clear(draft.value))) return
      if (!mounted.current) return
      unsavedRef.current = false
      dialog?.close()
      const [owner, name] = issue.full_name.split('/')
      navigate(
        `/workspace/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issue/${issue.number}`,
        {
          state: { userId, repositoryId },
        },
      )
    } catch {
      /* The mutation retains its safe error and the complete draft. */
    }
  }

  return (
    <>
      {/* Explicit creation entry point */}
      <Button
        className="h-8 text-xs"
        disabled={denied}
        onClick={() => dialog?.showModal()}
      >
        + {t('New issue')}
      </Button>

      {/* Modal draft uses native focus trapping and Escape handling */}
      <dialog
        ref={setDialog}
        aria-labelledby="new-issue-heading"
        onCancel={(event) => {
          event.preventDefault()
          void cancel()
        }}
        className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60"
      >
        <form
          className="space-y-5 p-6"
          aria-busy={write.isPending}
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          {/* Draft fields */}
          <h2 id="new-issue-heading" className="text-lg font-semibold">
            {t('New issue')}
          </h2>
          <label className="block text-xs font-medium">
            {t('Title')}
            <input
              autoFocus
              required
              value={title}
              disabled={
                !draft.ready || draft.clearing || write.isPending || denied
              }
              onChange={(event) =>
                draft.change({ ...draft.value, title: event.target.value })
              }
              className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {/* Shared description editor submits only its controlled Markdown string. */}
          <div className="space-y-2">
            <p className="text-xs font-medium">
              {t('Description (optional Markdown)')}
            </p>
            {draft.ready && (
              <MarkdownEditor
                value={body}
                onChange={(body) => draft.change({ ...draft.value, body })}
                label={t('Description')}
                fullName={fullName}
                disabled={draft.clearing || write.isPending || denied}
              />
            )}
          </div>

          {/* Status options share workspace styling and remain inside the modal. */}
          <div className="space-y-2">
            <p className="text-xs font-medium">{t('Status')}</p>
            <Select
              value={status}
              disabled={
                !draft.ready || draft.clearing || write.isPending || denied
              }
              onValueChange={(value) =>
                draft.change({ ...draft.value, status: value as IssueStatus })
              }
            >
              <SelectTrigger aria-label={t('Status')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent container={dialog}>
                {defaultStatuses
                  .filter((item) => item.state === 'open')
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {t(item.title)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Write feedback and draft actions */}
          {!draft.ready && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('Recovering local draft…')}
            </p>
          )}
          {draft.error && (
            <p role="alert" className="text-xs text-destructive">
              {t(draft.error)}
            </p>
          )}
          {write.isSuccess && write.data && (
            <p role="status" className="text-xs text-muted-foreground">
              <a
                href={write.data.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {t('Issue created on GitHub.')}
              </a>
            </p>
          )}
          {write.error && (
            <p role="alert" className="text-xs text-destructive">
              <Trans
                i18nKey={write.error.message}
                components={{ settingsLink: <RepositorySettingsLink /> }}
              />
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!draft.ready || draft.clearing || write.isPending}
              onClick={() => void cancel()}
            >
              {t(hasDraft || draft.error ? 'Discard draft' : 'Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                !draft.ready ||
                draft.clearing ||
                !title.trim() ||
                write.isPending ||
                denied
              }
            >
              {t(write.isPending ? 'Creating…' : 'Create issue')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
