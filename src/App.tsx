import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { WorkspaceSelector } from '@/components/workspace-selector'
import { LanguageSelect } from '@/components/language-select'

type User = { id: string; login: string; name: string | null }

/** Resolve authentication and offer a persistent app language beside the account actions. */
export default function App() {
  const { t } = useTranslation()
  const [queryClient] = useState(() => new QueryClient())
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)
  const [callbackError] = useState(() =>
    new URL(window.location.href).searchParams.get('auth_error'),
  )

  useEffect(() => {
    const controller = new AbortController()
    const url = new URL(window.location.href)
    if (callbackError) {
      url.searchParams.delete('auth_error')
      window.history.replaceState(
        null,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      )
    }

    /** Recover identity from the HttpOnly cookie and display only safe error messages. */
    async function restoreSession() {
      try {
        const response = await fetch('/api/auth/session', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (response.status === 401) {
          setSessionChecked(true)
          if (callbackError)
            setError(
              'GitHub authorization was cancelled, expired, or unsuccessful. Please connect again.',
            )
          return
        }
        const data = await response.json()
        if (!response.ok) {
          if (data.error === 'auth_not_configured') {
            setConfigured(false)
            setError(
              'GitHub authentication is not configured. Ask the server administrator to check the runtime settings in README.',
            )
            return
          }
          throw new Error('Session unavailable')
        }
        if (
          !data.user ||
          typeof data.user.id !== 'string' ||
          typeof data.user.login !== 'string'
        ) {
          throw new Error('Invalid session response')
        }
        setUser(data.user)
        setSessionChecked(true)
        if (callbackError)
          setError(
            'GitHub authorization did not complete. Your previous session is still connected.',
          )
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to check your session. Please try again shortly.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void restoreSession()
    return () => controller.abort()
  }, [callbackError])

  /** Clear private cached issues and return to login when a protected read rejects the session. */
  const handleSessionExpired = useCallback(() => {
    queryClient.clear()
    setUser(null)
    setError(
      'Your GitHub session expired or was revoked. Connect GitHub again to continue.',
    )
  }, [queryClient])

  /** Invalidate the server session before clearing the displayed identity and issue cache. */
  async function logout() {
    setLoggingOut(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Logout failed')
      queryClient.clear()
      setUser(null)
    } catch {
      setError(
        'Unable to log out. Your session may still be active; please try again.',
      )
    } finally {
      setLoggingOut(false)
    }
  }

  if (loading || !sessionChecked) {
    return (
      <main
        className="flex min-h-svh items-center justify-center bg-background bg-[radial-gradient(ellipse_at_center,var(--card)_0%,var(--background)_65%)] p-6 text-foreground"
        aria-busy={loading}
      >
        {/* Session resolution precedes both login and repository content */}
        <div
          className="max-w-sm text-center"
          role={loading ? 'status' : 'alert'}
        >
          <h1 className="text-[28px] font-semibold tracking-[-0.06em]">
            Issuel
          </h1>
          {loading ? (
            <>
              <span
                aria-hidden="true"
                className="relative mx-auto mt-5 block h-0.5 w-12 overflow-hidden rounded-full bg-foreground/10"
              >
                <span className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-foreground/60 motion-safe:animate-[issuel-loading_1.6s_ease-in-out_infinite]" />
              </span>
              <span className="sr-only">{t('Checking your session')}</span>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm font-medium">
                {t('Unable to open Issuel')}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(error ?? 'Your session could not be checked. Please retry.')}
              </p>
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => window.location.reload()}
              >
                {t('Try again')}
              </Button>
            </>
          )}
        </div>
      </main>
    )
  }

  if (user) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        {/* Account and session actions */}
        <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
          <span className="text-sm font-semibold tracking-tight">Issuel</span>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSelect />
            <span className="text-xs text-muted-foreground">@{user.login}</span>
            <Button
              onClick={logout}
              disabled={loggingOut}
              variant="outline"
              className="h-8 text-xs"
            >
              {t(loggingOut ? 'Logging out…' : 'Logout')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="w-full text-sm text-destructive">
              {t(error)}
            </p>
          )}
        </header>

        {/* User-scoped repository routing */}
        {!loggingOut && (
          <QueryClientProvider client={queryClient}>
            <WorkspaceSelector
              key={user.id}
              userId={user.id}
              onSessionExpired={handleSessionExpired}
            />
          </QueryClientProvider>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-20 max-w-5xl items-center gap-3 px-6">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground"
          >
            i
          </span>
          <span className="text-lg font-semibold tracking-tight">Issuel</span>
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {t('GITHUB ISSUES CLIENT')}
          </span>
          <LanguageSelect />
        </div>
      </header>

      {/* Introduction */}
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <p className="mb-5 text-xs font-semibold tracking-widest text-muted-foreground">
          {t('A FOCUSED WORKSPACE')}
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {t('A little more clarity.')}
          <br />
          {t('A little less issue.')}
        </h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
          {t(
            'A simpler way to work with GitHub Issues. Connect your GitHub account to get started.',
          )}
        </p>

        {/* GitHub authentication */}
        <section
          aria-labelledby="connection-heading"
          className="mt-12 max-w-xl rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-muted-foreground"
            />
            <h2 id="connection-heading" className="font-semibold">
              {t('Connect your workspace')}
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('Sign in securely with your GitHub account.')}
          </p>
          <p
            role="status"
            aria-live="polite"
            className="mt-5 min-h-6 text-sm text-muted-foreground"
          >
            {t(
              loading
                ? 'Checking your session…'
                : 'Your GitHub tokens stay on the server.',
            )}
          </p>

          {/* Authentication errors */}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(error)}
            </p>
          )}

          {/* Authentication actions */}
          <div className="mt-5 flex gap-3">
            <form method="post" action="/api/auth/login">
              <Button type="submit" disabled={loading || !configured}>
                {t('Connect GitHub')}
              </Button>
            </form>
            {error && !loading && (
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                {t('Try again')}
              </Button>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-muted-foreground">
        {t('Issuel · Made for focus.')}
      </footer>
    </div>
  )
}
