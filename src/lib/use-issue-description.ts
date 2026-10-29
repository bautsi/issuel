import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { IssueReadError } from '@/lib/issues'
import { sameMarkdownContent } from '@/lib/markdown-safety'
import type { IssueDetail } from '@/lib/use-issue-detail'
import { DescriptionSaveError, useIssueWrite } from '@/lib/use-issue-write'

type Draft = {
  baseline: string
  localDraft: string
  latestRemote: string | null
  safe: boolean
  saving: boolean
  error: string | null
}

/** Keep Markdown edits local until explicit Save, retaining drafts on failed or conflicting writes. */
export function useIssueDescription(
  userId: string,
  repositoryId: number | null,
  number: number,
  canWrite: boolean,
) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [failure, setFailure] = useState<{
    operation: 'save' | 'cancel'
    retryAt: number
  } | null>(null)
  const current = useRef<Draft | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const { submit } = useIssueWrite(userId, repositoryId, number)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Keep event handlers and pending responses on the same draft before React's next render. */
  const update = useCallback((next: Draft | null) => {
    if (!mounted.current) return
    current.current = next
    setDraft(next)
  }, [])

  /** Capture a provider body once; cache refreshes never replace an open editor's baseline. */
  function open(issue: IssueDetail) {
    if (current.current || !canWrite) return
    setSaved(false)
    const body = issue.body ?? ''
    update({
      baseline: body,
      localDraft: body,
      latestRemote: null,
      safe: true,
      saving: false,
      error: null,
    })
  }

  /** Preserve exact source input and restore raw baseline bytes when rich edits return to its meaning. */
  function change(localDraft: string, mode?: 'rich' | 'source') {
    const snapshot = current.current
    if (!snapshot) return
    update({
      ...snapshot,
      localDraft:
        mode === 'rich' && sameMarkdownContent(snapshot.baseline, localDraft)
          ? snapshot.baseline
          : localDraft,
    })
  }

  /** Block Save after a rejected conversion until complete source input is confirmed. */
  function safety(safe: boolean) {
    if (current.current && current.current.safe !== safe)
      update({ ...current.current, safe })
  }

  /** Save explicitly; confirmed overwrite compares the reviewed remote instead of bypassing conflict checks. */
  const save = useCallback(
    async (force = false) => {
      const snapshot = current.current
      const baseline = force ? snapshot?.latestRemote : snapshot?.baseline
      if (
        !snapshot ||
        baseline == null ||
        !canWrite ||
        !snapshot.safe ||
        inFlight.current ||
        (!force && snapshot.latestRemote !== null) ||
        snapshot.localDraft === baseline
      )
        return
      inFlight.current = true
      setFailure(null)
      // Explicit confirmation accepts the displayed remote as the expected provider baseline.
      update({
        ...snapshot,
        baseline,
        latestRemote: null,
        saving: true,
        error: null,
      })
      try {
        const accepted = await submit({
          body: snapshot.localDraft,
          baseline,
        })
        if (!mounted.current || !current.current) return
        if (!accepted)
          throw new Error(
            'Description could not be saved. Your local draft is retained.',
          )
        if (current.current.localDraft === snapshot.localDraft) {
          update(null)
          setSaved(true)
          return
        }
        // Do not replace localDraft: the user may have typed or undone text while PATCH was pending.
        update({
          ...current.current,
          baseline: accepted.body ?? '',
          saving: false,
          error: null,
        })
      } catch (error) {
        if (!mounted.current || !current.current) return
        const remote =
          error instanceof DescriptionSaveError ? error.latestRemote : undefined
        const latestRemote =
          remote !== undefined && remote !== baseline ? remote : null
        const retryable =
          !(error instanceof IssueReadError) ||
          error.status === 429 ||
          error.status >= 500
        update({
          ...current.current,
          saving: false,
          latestRemote,
          error:
            error instanceof Error
              ? error.message
              : 'Description could not be saved. Your local draft is retained.',
        })
        setFailure(
          latestRemote === null && retryable
            ? {
                operation: 'save',
                retryAt:
                  error instanceof IssueReadError && error.retryAt > Date.now()
                    ? error.retryAt
                    : 0,
              }
            : null,
        )
      } finally {
        inFlight.current = false
      }
    },
    [canWrite, submit, update],
  )

  /** Refresh the protected detail without discarding any editor opened after the original cancellation. */
  async function refreshRemote() {
    if (inFlight.current) return
    inFlight.current = true
    setCanceling(true)
    setFailure(null)
    const queryKey = ['github', userId, repositoryId, 'issue', number] as const
    try {
      await client.cancelQueries({ queryKey, exact: true })
      // Reuse the mounted detail query's account checks and update its cache from a fresh GET.
      await client.fetchQuery<IssueDetail>({
        queryKey,
        staleTime: 0,
        retry: false,
      })
    } catch (error) {
      if (mounted.current)
        setFailure({
          operation: 'cancel',
          retryAt:
            error instanceof IssueReadError && error.retryAt > Date.now()
              ? error.retryAt
              : 0,
        })
    } finally {
      inFlight.current = false
      if (mounted.current) setCanceling(false)
    }
  }

  /** Discard only after caller confirmation and exit immediately; refresh errors stay non-blocking. */
  async function close() {
    if (!current.current || inFlight.current) return
    update(null)
    setSaved(false)
    await refreshRemote()
  }

  /** Retry only the interrupted explicit operation, retaining its baseline and existing write safeguards. */
  async function retry() {
    if (!failure || inFlight.current) return
    if (failure.operation === 'cancel') await refreshRemote()
    else await save()
  }

  const status = !draft
    ? saved
      ? 'Saved'
      : null
    : canceling
      ? 'Loading…'
      : draft.latestRemote !== null
        ? 'Conflict'
        : !draft.safe
          ? 'Unsafe Conversion'
          : draft.saving
            ? 'Saving'
            : draft.error
              ? 'Save Failed'
              : draft.localDraft !== draft.baseline
                ? 'Unsaved'
                : null
  const dirty =
    draft !== null &&
    (draft.localDraft !== draft.baseline ||
      draft.saving ||
      draft.latestRemote !== null ||
      !!draft.error ||
      !draft.safe)

  return {
    draft,
    status,
    dirty,
    canceling,
    failure,
    open,
    change,
    safety,
    save,
    close,
    retry,
  }
}
