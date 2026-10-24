import { useState } from 'react'
import { Button } from '@/components/ui/button'

/** Display the project foundation and check connectivity to the Hono API. */
export default function App() {
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'healthy' | 'error'
  >('idle')

  /** Request the same-origin health endpoint and report its response. */
  async function checkHealth() {
    setStatus('checking')

    try {
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error('Health check failed')

      const health: unknown = await response.json()
      if (
        typeof health !== 'object' ||
        health === null ||
        !('status' in health) ||
        health.status !== 'ok'
      ) {
        throw new Error('Unexpected health response')
      }

      setStatus('healthy')
    } catch {
      setStatus('error')
    }
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
            GITHUB ISSUES CLIENT
          </span>
        </div>
      </header>

      {/* Introduction */}
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <p className="mb-5 text-xs font-semibold tracking-widest text-muted-foreground">
          A FOCUSED WORKSPACE
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          A little more clarity.
          <br />A little less issue.
        </h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
          The foundation for a simpler way to work with GitHub Issues. Your
          workspace starts here.
        </p>

        {/* API connection */}
        <section
          aria-labelledby="connection-heading"
          className="mt-12 max-w-xl rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${status === 'healthy' ? 'bg-emerald-600' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'}`}
            />
            <h2 id="connection-heading" className="font-semibold">
              Workspace connection
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Check that your workspace can reach the server.
          </p>
          <p
            role="status"
            aria-live="polite"
            className={`mt-5 min-h-6 text-sm ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {status === 'idle' && 'Ready when you are.'}
            {status === 'checking' && 'Checking connection…'}
            {status === 'healthy' && 'Connected. Your workspace is ready.'}
            {status === 'error' &&
              'Unable to reach the server. Please try again.'}
          </p>
          <Button
            onClick={checkHealth}
            disabled={status === 'checking'}
            className="mt-5"
            variant={status === 'healthy' ? 'outline' : 'default'}
          >
            {status === 'checking'
              ? 'Checking…'
              : status === 'healthy'
                ? 'Check again'
                : 'Check connection'}
          </Button>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-muted-foreground">
        Issuel · Made for focus.
      </footer>
    </div>
  )
}
