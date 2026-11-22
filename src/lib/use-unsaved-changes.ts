import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useBeforeUnload } from 'react-router'
import { useTranslation } from 'react-i18next'

const activeDrafts = new Set<{ current: boolean }>()

/** Let the workspace's single navigation blocker protect every independently edited draft. */
export function hasUnsavedChanges() {
  return [...activeDrafts].some((draft) => draft.current)
}

/** Confirm before leaving any active repository editor, including independently edited settings. */
export function useUnsavedChanges(dirty: boolean) {
  const { t } = useTranslation()
  const pending = useRef(false)
  useLayoutEffect(() => {
    pending.current = dirty
  }, [dirty])
  const message = t('You have unsaved changes. Leave and discard them?')
  useEffect(() => {
    activeDrafts.add(pending)
    return () => {
      activeDrafts.delete(pending)
    }
  }, [])
  useBeforeUnload(
    useCallback((event) => {
      if (!pending.current) return
      event.preventDefault()
      event.returnValue = ''
    }, []),
  )
  useEffect(() => {
    /** Keep logout and account changes from silently unmounting a local draft. */
    function confirmDiscard(event: Event) {
      if (pending.current && !window.confirm(message)) event.preventDefault()
    }
    window.addEventListener('issuel:before-discard', confirmDiscard)
    return () =>
      window.removeEventListener('issuel:before-discard', confirmDiscard)
  }, [message])
  return pending
}
