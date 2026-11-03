import { useEffect, useState } from 'react'
import { defaultStatuses } from '@/lib/issues'
import type { IssueStatus } from '@/lib/issues'

type Draft = { title: string; body: string; status: IssueStatus }
const empty: Draft = { title: '', body: '', status: 'backlog' }
let queue: Promise<unknown> = Promise.resolve()

/** Serialize native IndexedDB transactions, including recovery and deletion, in input order. */
function storeDraft(
  key: string,
  value?: Draft | null,
  submitted?: Draft,
): Promise<unknown> {
  const operation = queue
    .catch(() => undefined)
    .then(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('issuel-drafts', 1)
          let database: IDBDatabase | undefined
          let transaction: IDBTransaction | undefined
          let expired = false
          const timeout = window.setTimeout(() => {
            expired = true
            try {
              transaction?.abort()
            } catch {
              /* A completed transaction needs no abort. */
            }
            database?.close()
            reject(new Error('Draft storage timed out'))
          }, 5000)
          request.onupgradeneeded = () => {
            request.result.createObjectStore('drafts')
          }
          request.onerror = request.onblocked = () => {
            expired = true
            clearTimeout(timeout)
            reject(new Error('Draft storage unavailable'))
          }
          request.onsuccess = () => {
            database = request.result
            if (expired) {
              database.close()
              return
            }
            database.onversionchange = () => database?.close()
            try {
              transaction = database.transaction(
                'drafts',
                value === undefined ? 'readonly' : 'readwrite',
              )
              const store = transaction.objectStore('drafts')
              const action =
                value === undefined || (value === null && submitted)
                  ? store.get(key)
                  : value === null
                    ? store.delete(key)
                    : store.put(
                        key.endsWith('/new-issue')
                          ? value
                          : { body: value.body },
                        key,
                      )
              if (value === null && submitted)
                action.onsuccess = () => {
                  const saved = action.result as Partial<Draft> | undefined
                  // A previous submission must not delete newer input from a remounted composer.
                  if (
                    saved?.body === submitted.body &&
                    (!key.endsWith('/new-issue') ||
                      (saved.title === submitted.title &&
                        saved.status === submitted.status))
                  )
                    store.delete(key)
                }
              transaction.oncomplete = () => {
                clearTimeout(timeout)
                database?.close()
                resolve(action.result)
              }
              transaction.onabort = transaction.onerror = () => {
                clearTimeout(timeout)
                database?.close()
                reject(new Error('Draft transaction failed'))
              }
            } catch (error) {
              clearTimeout(timeout)
              database.close()
              reject(error)
            }
          }
        }),
    )
  queue = operation
  return operation
}

/** Recover only unsent Markdown and persist explicit input under its captured account/resource key. */
export function useLocalDraft(
  userId: string,
  repositoryId: number | null,
  number?: number,
) {
  const key =
    repositoryId === null
      ? null
      : `${userId}/${repositoryId}/${number === undefined ? 'new-issue' : `${number}/new-comment`}`
  const [state, setState] = useState<{
    key: string | null
    value: Draft
    ready: boolean
    pending: boolean
    clearing: boolean
    error: string | null
  }>({
    key: null,
    value: empty,
    ready: false,
    pending: false,
    clearing: false,
    error: null,
  })

  useEffect(() => {
    if (key === null) return
    let active = true
    void storeDraft(key)
      .then((saved) => {
        if (!active) return
        const value = saved as Partial<Draft> | undefined
        if (
          saved !== undefined &&
          (!value ||
            typeof value.body !== 'string' ||
            (number === undefined &&
              (typeof value.title !== 'string' ||
                !defaultStatuses.some(
                  (status) =>
                    status.state === 'open' && status.id === value.status,
                ))))
        )
          throw new Error('Invalid draft')
        setState({
          key,
          value: {
            title: number === undefined ? (value?.title ?? '') : '',
            body: value?.body ?? '',
            status:
              number === undefined ? (value?.status ?? 'backlog') : 'backlog',
          },
          ready: true,
          pending: false,
          clearing: false,
          error: null,
        })
      })
      .catch(() => {
        if (active)
          setState({
            key,
            value: empty,
            ready: true,
            pending: false,
            clearing: false,
            error:
              'Draft recovery failed. You can still write, but previously saved content could not be loaded.',
          })
      })
    return () => {
      active = false
    }
  }, [key, number])

  /** Save exactly the controlled Markdown without a GitHub request or a delayed effect on another key. */
  function change(value: Draft) {
    if (key === null || state.key !== key || !state.ready || state.clearing)
      return
    setState((current) => ({ ...current, value, pending: true }))
    void storeDraft(key, value)
      .then(() => {
        setState((current) =>
          current.key === key && current.value === value
            ? { ...current, pending: false, error: null }
            : current,
        )
      })
      .catch(() => {
        setState((current) =>
          current.key === key && current.value === value
            ? {
                ...current,
                pending: false,
                error:
                  'Local draft could not be saved. Keep this page open or copy your text before leaving.',
              }
            : current,
        )
      })
  }

  /** Delete only this draft after explicit discard or confirmed submission, behind all earlier saves. */
  async function clear(submitted?: Draft) {
    if (key === null) return false
    setState((current) =>
      current.key === key
        ? { ...current, value: empty, pending: true, clearing: true }
        : current,
    )
    try {
      await storeDraft(key, null, submitted)
      setState((current) =>
        current.key === key
          ? { ...current, pending: false, clearing: false, error: null }
          : current,
      )
      return true
    } catch {
      setState((current) =>
        current.key === key
          ? {
              ...current,
              pending: false,
              clearing: false,
              error:
                'Saved draft could not be cleared. Discard again before leaving to prevent old content from returning.',
            }
          : current,
      )
      return false
    }
  }

  return {
    value: state.key === key ? state.value : empty,
    ready: key !== null && state.key === key && state.ready,
    pending: state.key === key && state.pending,
    clearing: state.key === key && state.clearing,
    error: state.key === key ? state.error : null,
    change,
    clear,
  }
}
