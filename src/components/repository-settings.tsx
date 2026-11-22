import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRepositoryConfig } from '@/lib/use-repository-config'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'
import { requestIssueRead } from '@/lib/use-issue-detail'
import { IssueReadError } from '@/lib/issues'
import {
  defaultStatusMapping,
  getStatuses,
  validateStatusMapping,
} from '../../server/issue-status'
import type { StatusMapping } from '../../server/issue-status'
import type { readIssueOptions } from '../../server/issue-detail'

const settingsTriggerId = 'repository-settings-trigger'

/** Open the current repository's settings from inline issue feedback. */
export function RepositorySettingsLink({ children }: { children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="cursor-pointer underline underline-offset-2"
      onClick={() => document.getElementById(settingsTriggerId)?.click()}
    >
      {children}
    </button>
  )
}

/** Edit repository mappings and show advisory usage information for the selected labels. */
export function RepositorySettings({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation()
  const config = useRepositoryConfig()
  const { userId, repositoryId } = config.data
  const [open, setOpen] = useState(config.data.validationErrors.length > 0)
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)
  const [draft, setDraft] = useState<{
    mapping: StatusMapping
    sha: string | null
    branch: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const busy = useRef(false)
  const initializing = config.data.sha === null
  const mapping = draft?.mapping ?? config.data.mapping
  const dirty = Object.keys(mapping).some(
    (key) =>
      mapping[key as keyof StatusMapping] !==
      config.data.mapping[key as keyof StatusMapping],
  )
  useUnsavedChanges(dirty)
  const labels = useQuery({
    queryKey: ['github', userId, repositoryId, 'options', 'labels'],
    queryFn: async ({
      signal,
    }): Promise<Awaited<ReturnType<typeof readIssueOptions>>> => {
      const data = await requestIssueRead(
        `/api/repositories/${repositoryId}/labels`,
        signal,
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
    enabled: open,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const { errors, missingDefaultLabels } = labels.data
    ? validateStatusMapping(
        mapping,
        labels.data.labels.map((label) => label.name),
      )
    : { errors: [], missingDefaultLabels: [] }
  const existingLabels = new Set(
    labels.data?.labels.map((label) => label.name.toLowerCase()),
  )
  const usageLabels = [
    ...new Set(
      [mapping.inProgress, mapping.inReview, mapping.todo].flatMap((label) => {
        const existing = labels.data?.labels.find(
          (item) => item.name.toLowerCase() === label?.toLowerCase(),
        )
        return existing ? [existing.name] : []
      }),
    ),
  ]
  const usage = useQuery({
    queryKey: [
      'github',
      userId,
      repositoryId,
      'status-label-usage',
      usageLabels,
    ],
    queryFn: async ({ signal }): Promise<string[]> => {
      const params = new URLSearchParams()
      for (const label of usageLabels) params.append('label', label)
      const data = await requestIssueRead(
        `/api/repositories/${repositoryId}/status-label-usage?${params}`,
        signal,
      )
      if (
        data?.userId !== userId ||
        data.repositoryId !== repositoryId ||
        !Array.isArray(data.unusedLabels) ||
        !data.unusedLabels.every(
          (label: unknown) =>
            typeof label === 'string' && usageLabels.includes(label),
        )
      )
        throw new IssueReadError(
          'The server returned invalid issue content.',
          502,
        )
      return data.unusedLabels
    },
    enabled: open && !labels.isError && usageLabels.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const unusedLabels = labels.isError
    ? []
    : [...missingDefaultLabels, ...(usage.isError ? [] : (usage.data ?? []))]
  const pending = config.save.isPending || config.isFetching
  const canSave =
    canWrite &&
    !pending &&
    (initializing || dirty) &&
    !!labels.data &&
    !labels.isError &&
    errors.length === 0 &&
    !config.save.error

  useEffect(() => {
    if (open && dialog && !dialog.open) dialog.showModal()
  }, [open, dialog])

  /** Keep unsaved choices when dismissing the modal and prevent dismissal during requests. */
  function close() {
    if (busy.current || pending) return
    dialog?.close()
    setOpen(false)
  }

  /** Save once per explicit click and preserve the mapping whenever GitHub rejects or cannot confirm it. */
  async function save() {
    if (busy.current || !canSave) return
    busy.current = true
    setNotice('')
    try {
      await config.save.mutateAsync({
        ...config.data,
        ...(draft ?? { mapping }),
      })
      setDraft(null)
      setNotice('Status mapping saved to GitHub.')
    } catch {
      /* The mutation retains sanitized feedback and the unsaved draft. */
    } finally {
      busy.current = false
    }
  }

  /** Refresh the SHA and remote mapping while retaining the user's current choices for review. */
  async function reload() {
    if (busy.current || pending) return
    busy.current = true
    setNotice('')
    try {
      const { data: latest } = await config.refetch({ throwOnError: true })
      await labels.refetch({ throwOnError: true })
      if (usageLabels.length) void usage.refetch()
      setDraft(
        dirty && latest
          ? { mapping, sha: latest.sha, branch: latest.branch }
          : null,
      )
      config.save.reset()
      setNotice(
        dirty
          ? 'Remote config reloaded. Review your draft before saving; Cancel restores the remote mapping.'
          : 'Remote config reloaded.',
      )
    } catch {
      /* Query errors remain visible; the draft is retained. */
    } finally {
      busy.current = false
    }
  }

  return (
    <>
      {/* Repository settings entry */}
      <Button
        id={settingsTriggerId}
        type="button"
        variant="outline"
        aria-label={t('Settings')}
        title={t('Settings')}
        aria-haspopup="dialog"
        className="size-8 border-transparent bg-transparent p-0 text-muted-foreground shadow-none"
        onClick={() => setOpen(true)}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 3-.6 2.4-2 1.2L4 6l-2 3.5 1.8 1.8v2.4L2 15.5 4 19l2.4-.6 2 1.2L9 22h6l.6-2.4 2-1.2 2.4.6 2-3.5-1.8-1.8v-2.4L22 9.5 20 6l-2.4.6-2-1.2L15 3Z" />
          <circle cx="12" cy="12.5" r="3" />
        </svg>
      </Button>

      {/* Modal settings keep focus and label menus inside the native dialog */}
      <dialog
        ref={setDialog}
        aria-labelledby="repository-settings-heading"
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-2xl backdrop:bg-black/60"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2
            id="repository-settings-heading"
            className="text-lg font-semibold"
          >
            {t('Settings')} · {t('Status mapping')}
          </h2>
          <Button
            type="button"
            variant="outline"
            aria-label={t('Close')}
            title={t('Close')}
            disabled={pending}
            className="size-8 shrink-0 p-0"
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>

        {/* Existing-label mapping and explicit persistence */}
        {open && (
          <div className="space-y-4 text-sm" aria-busy={pending}>
            <p className="text-xs text-muted-foreground">
              {t('Config file')}: .github/issuel-client.yml ·{' '}
              {config.data.branch}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('Saving config does not modify issues or create labels.')}
            </p>
            {initializing && (
              <p role="status">
                {t('No config file. Using default status mapping.')}
              </p>
            )}
            {getStatuses(mapping)
              .filter((status) => status.state === 'open')
              .map((status) => {
                const defaultLabel = defaultStatusMapping[status.id]
                const defaultName = defaultLabel?.toLowerCase()
                const isDefault =
                  defaultLabel !== null &&
                  status.label?.toLowerCase() === defaultName
                const selectedLabel = isDefault ? defaultLabel : status.label

                return (
                  <div
                    key={status.id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <p>
                        {t(status.title)}{' '}
                        <span className="text-xs text-muted-foreground">
                          (
                          {config.data.mapping[status.id] ?? t('Fallback only')}
                          )
                        </span>
                      </p>
                      {status.id === 'backlog' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(
                            'Fallback for open issues with no matching status label.',
                          )}
                        </p>
                      )}
                    </div>
                    <Select
                      value={
                        selectedLabel === null
                          ? 'fallback'
                          : `label:${selectedLabel}`
                      }
                      disabled={
                        !canWrite || pending || !labels.data || labels.isError
                      }
                      onValueChange={(value) => {
                        setDraft({
                          sha: draft ? draft.sha : config.data.sha,
                          branch: draft?.branch ?? config.data.branch,
                          mapping: {
                            ...mapping,
                            [status.id]:
                              value === 'fallback' ? null : value.slice(6),
                          },
                        })
                        setNotice('')
                      }}
                    >
                      <SelectTrigger
                        aria-label={`${t(status.title)} ${t('Status mapping')}`}
                        className="w-64 max-w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent container={dialog}>
                        <SelectItem
                          value="fallback"
                          disabled={status.id !== 'backlog'}
                        >
                          {t(
                            status.id === 'backlog'
                              ? 'Fallback only'
                              : 'Select a label',
                          )}
                        </SelectItem>
                        {defaultLabel !== null && (
                          <SelectItem value={`label:${defaultLabel}`}>
                            {defaultLabel}
                          </SelectItem>
                        )}
                        {selectedLabel !== null &&
                          !isDefault &&
                          !labels.data?.labels.some(
                            (label) => label.name === selectedLabel,
                          ) && (
                            <SelectItem
                              value={`label:${selectedLabel}`}
                              disabled={
                                !existingLabels.has(selectedLabel.toLowerCase())
                              }
                            >
                              {selectedLabel}
                            </SelectItem>
                          )}
                        {labels.data?.labels
                          .filter(
                            (label) => label.name.toLowerCase() !== defaultName,
                          )
                          .map((label) => (
                            <SelectItem
                              key={label.id}
                              value={`label:${label.name}`}
                            >
                              {label.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}

            {/* Validation and remote save feedback */}
            {dirty && (
              <p role="status" className="text-amber-400">
                {t('Unsaved changes')}
              </p>
            )}
            {labels.isPending && <p role="status">{t('Loading…')}</p>}
            {labels.error && (
              <p role="alert" className="text-destructive">
                {t(labels.error.message)}
              </p>
            )}
            {unusedLabels.length > 0 && (
              <div role="status" className="space-y-1 text-amber-400">
                <p>{t('Status labels not used by any issue:')}</p>
                <ul className="list-disc ps-5">
                  {unusedLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
                <p>
                  {t(
                    'This is normal for new repositories. If you are migrating, check that these mappings match the labels used on GitHub.',
                  )}
                </p>
              </div>
            )}
            {usage.isError && !labels.isError && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('Could not check which status labels are in use.')}
              </p>
            )}
            {errors.length > 0 && (
              <ul role="alert" className="text-destructive">
                {errors.map((error, index) => (
                  <li key={index}>
                    {error.startsWith('Mapped label does not exist: ')
                      ? t('Mapped label does not exist: {{label}}', {
                          label: error.slice(
                            'Mapped label does not exist: '.length,
                          ),
                        })
                      : t(error)}
                  </li>
                ))}
              </ul>
            )}
            {config.save.error && (
              <p role="alert" className="text-destructive">
                {t(config.save.error.message)}
              </p>
            )}
            {notice && <p role="status">{t(notice)}</p>}
            {!canWrite && (
              <p>
                {t(
                  'Saving config requires repository push access and App Contents write permission.',
                )}
              </p>
            )}

            {/* Save, discard and draft-preserving remote reload */}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canSave} onClick={() => void save()}>
                {t(
                  config.save.isPending
                    ? 'Saving…'
                    : initializing
                      ? 'Initialize & Save'
                      : 'Save Changes',
                )}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setDraft(null)
                  setNotice('')
                  config.save.reset()
                  close()
                }}
              >
                {t('Cancel')}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void reload()}
              >
                {t('Reload remote config')}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
