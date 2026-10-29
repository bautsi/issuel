import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { defaultStatuses, IssueReadError } from '@/lib/issues'
import type { IssueStatus } from '@/lib/issues'
import { useIssueWrite } from '@/lib/use-issue-write'
import { MarkdownEditor } from '@/components/markdown-editor'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'

/** Compose Markdown in either mode, retain failed drafts and open the confirmed GitHub issue. */
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
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<IssueStatus>('backlog')
  const write = useIssueWrite(userId, repositoryId)
  const unsavedRef = useUnsavedChanges(
    !!title || !!body || status !== 'backlog',
  )
  const denied =
    write.error instanceof IssueReadError && write.error.status === 403
  useEffect(() => {
    if (write.error instanceof IssueReadError && write.error.status === 401)
      onSessionExpired()
  }, [write.error, onSessionExpired])

  /** Preserve the draft until a confirmed result, without automatically retrying an uncertain write. */
  async function create() {
    if (!title.trim() || write.isPending || denied) return
    try {
      const issue = await write.submit({ title, body, status })
      if (!issue) return
      unsavedRef.current = false
      dialog.current?.close()
      setTitle('')
      setBody('')
      setStatus('backlog')
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
        onClick={() => dialog.current?.showModal()}
      >
        + {t('New issue')}
      </Button>

      {/* Modal draft uses native focus trapping and Escape handling */}
      <dialog
        ref={dialog}
        aria-labelledby="new-issue-heading"
        onCancel={(event) => {
          if (write.isPending) event.preventDefault()
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
              disabled={write.isPending || denied}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {/* Shared description editor submits only its controlled Markdown string. */}
          <div className="space-y-2">
            <p className="text-xs font-medium">
              {t('Description (optional Markdown)')}
            </p>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              label={t('Description')}
              fullName={fullName}
              disabled={write.isPending || denied}
            />
          </div>
          <label className="block text-xs font-medium">
            {t('Status')}
            <select
              value={status}
              disabled={write.isPending || denied}
              onChange={(event) => setStatus(event.target.value as IssueStatus)}
              className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {defaultStatuses
                .filter((item) => item.state === 'open')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.title)}
                  </option>
                ))}
            </select>
          </label>

          {/* Write feedback and draft actions */}
          {write.error && (
            <p role="alert" className="text-xs text-destructive">
              {t(write.error.message)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={write.isPending}
              onClick={() => dialog.current?.close()}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || write.isPending || denied}
            >
              {t(write.isPending ? 'Creating…' : 'Create issue')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
