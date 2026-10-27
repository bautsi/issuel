import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import { useTranslation } from 'react-i18next'

/** Confirm before route changes, logout or page unload discard an in-memory editor draft. */
export function useUnsavedChanges(dirty: boolean) {
  const { t } = useTranslation()
  const pending = useRef(false)
  useLayoutEffect(() => { pending.current = dirty }, [dirty])
  const message = t('You have unsaved changes. Leave and discard them?')
  useBlocker(() => pending.current && !window.confirm(message))
  useBeforeUnload(useCallback((event) => {
    if (!pending.current) return
    event.preventDefault()
    event.returnValue = ''
  }, []))
  useEffect(() => {
    /** Keep logout and account changes from silently unmounting a local draft. */
    function confirmDiscard(event: Event) {
      if (pending.current && !window.confirm(message)) event.preventDefault()
    }
    window.addEventListener('issuel:before-discard', confirmDiscard)
    return () => window.removeEventListener('issuel:before-discard', confirmDiscard)
  }, [message])
  return pending
}
