import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type Repository = {
  id: number
  name: string
  full_name: string
  owner: string
  private: boolean
}

/** Select one server-verified repository and retain only its ID for this GitHub user. */
export function WorkspaceSelector({ userId, onSessionExpired }: {
  userId: string
  onSessionExpired: () => void
}) {
  const storageKey = `issuel:workspace:${userId}`
  const [preference] = useState(() => {
    try {
      return { id: window.localStorage.getItem(storageKey), unavailable: false }
    } catch {
      return { id: null, unavailable: true }
    }
  })
  const [{ id: selectedId, revoked }, setSelection] = useState({ id: preference.id, revoked: false })
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storageUnavailable, setStorageUnavailable] = useState(preference.unavailable)
  const [installationUrl, setInstallationUrl] = useState<string | null>(null)
  const [installationNotice, setInstallationNotice] = useState<string | null>(null)
  const [open, setOpen] = useState(!preference.id)
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let controller: AbortController | undefined

    /** Recheck current access on mount, retry and return from GitHub; discard older requests. */
    async function loadRepositories() {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/repositories', { signal, cache: 'no-store' })
        const data = await response.json()
        if (signal.aborted) return
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if (!response.ok) {
          const messages: Record<string, string> = {
            github_forbidden: 'GitHub denied repository access. Check the App permissions and organization approval, then retry.',
            github_not_found: 'A GitHub installation is no longer accessible. Check App access, then retry.',
            github_rate_limited: `GitHub rate limit reached. Retry after ${Number.isSafeInteger(data.retryAfter) ? data.retryAfter : 60} seconds.`,
            auth_not_configured: 'GitHub authentication is not configured on the server.',
            refresh_in_progress: 'Your session is being refreshed. Please retry shortly.',
          }
          throw new Error(messages[data.error] ?? 'Unable to load repositories from GitHub. Please retry shortly.')
        }
        if (data.userId !== userId || !Array.isArray(data.repositories)) {
          throw new Error('Your GitHub session changed. Reload the page to continue.')
        }
        setRepositories(data.repositories)
        setInstallationUrl(data.installationUrl)
        setInstallationNotice(data.installationNotice)
        // A failed request never erases a preference; only a complete fresh list can invalidate it.
        let savedId: string | null = null
        try {
          savedId = window.localStorage.getItem(storageKey)
        } catch {
          setStorageUnavailable(true)
        }
        if (savedId && !data.repositories.some((repository: Repository) => String(repository.id) === savedId)) {
          try {
            window.localStorage.removeItem(storageKey)
          } catch {
            setStorageUnavailable(true)
          }
          setOpen(true)
        }
        setSelection(current => {
          const id = savedId ?? current.id
          return id && !data.repositories.some((repository: Repository) => String(repository.id) === id)
            ? { id: null, revoked: true }
            : { id, revoked: current.revoked }
        })
      } catch (failure) {
        if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load repositories. Please retry.')
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void loadRepositories()
    window.addEventListener('focus', loadRepositories)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', loadRepositories)
    }
  }, [userId, storageKey, revision, onSessionExpired])

  const selected = !loading && !error ? repositories.find(repository => String(repository.id) === selectedId) : undefined
  const filtered = repositories.filter(repository => repository.full_name.toLowerCase().includes(search.trim().toLowerCase()))

  /** Persist a choice from the fresh accessible list without changing the GitHub authorization. */
  function selectRepository(repository: Repository) {
    if (loading || error || !repositories.some(item => item.id === repository.id)) return
    const id = String(repository.id)
    setSelection({ id, revoked: false })
    setOpen(false)
    setSearch('')
    try {
      window.localStorage.setItem(storageKey, id)
    } catch {
      setStorageUnavailable(true)
    }
  }

  /** Hide the old access list while requesting a complete fresh snapshot. */
  function refreshRepositories() {
    setLoading(true)
    setRevision(current => current + 1)
  }

  /** Open the picker and refresh GitHub access before another workspace can be selected. */
  function toggleSelector() {
    if (!open) refreshRepositories()
    setOpen(current => !current)
  }

  return (
    <section aria-labelledby="workspace-heading" aria-busy={loading} className="mt-6 max-w-xl rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
      {/* Current workspace */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-widest text-muted-foreground">WORKSPACE</p>
          <h2 id="workspace-heading" className="mt-2 break-words text-lg font-semibold">
            {loading ? 'Loading repositories…' : error ? 'Workspace unavailable' : selected ? selected.name : 'Choose a repository'}
          </h2>
          {selected && (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {selected.owner} <span className="ml-2 rounded border px-1.5 py-0.5 text-xs">{selected.private ? 'Private' : 'Public'}</span>
            </p>
          )}
        </div>
        <Button variant="outline" onClick={toggleSelector} disabled={loading || !!error} aria-expanded={open || !selected} aria-controls="repository-picker">
          {selected ? open ? 'Close' : 'Switch workspace' : 'Select repository'}
        </Button>
      </div>

      {/* Discovery and access states */}
      {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Checking repositories you can access through this GitHub App…</p>}
      {error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button className="mt-3" variant="outline" onClick={refreshRepositories}>Retry</Button>
        </div>
      )}
      {revoked && (
        <p role="alert" className="mt-4 text-sm text-destructive">Repository access revoked or repository removed. Your previous workspace was cleared. Choose another repository.</p>
      )}
      {storageUnavailable && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">Browser storage is unavailable. Your choice works for this visit but may not be remembered.</p>
      )}

      {/* Repository picker */}
      {!loading && !error && (open || !selected) && (
        <div id="repository-picker" className="mt-5 border-t pt-5">
          {repositories.length === 0 ? (
            <div>
              <p className="font-medium">No accessible repositories</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">You are signed in to GitHub. To use a repository, this GitHub App must also be installed on the account that owns it and granted access to it.</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>Use the installation link below, or ask the App owner for one.</li>
                <li>Choose the personal or organization account that owns your repository, then select the repositories to allow. If already installed, use Configure to update Repository access.</li>
                <li>Return here and select Refresh repositories. Organization access may require an administrator’s approval.</li>
              </ol>
            </div>
          ) : (
            <>
              <label htmlFor="repository-search" className="text-sm font-medium">Search repositories</label>
              <input id="repository-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search owner or repository name…" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <ul aria-label="Accessible repositories" className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                {filtered.map(repository => (
                  <li key={repository.id}>
                    <Button variant="outline" onClick={() => selectRepository(repository)} aria-pressed={String(repository.id) === selectedId} className="h-auto min-h-14 w-full justify-start gap-3 border-transparent px-3 text-left shadow-none">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{repository.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">{repository.owner}</span>
                      </span>
                      <span className="rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{repository.private ? 'Private' : 'Public'}</span>
                      <span className="w-4" aria-hidden="true">{String(repository.id) === selectedId ? '✓' : ''}</span>
                    </Button>
                  </li>
                ))}
              </ul>
              {filtered.length === 0 && <p role="status" className="mt-3 text-sm text-muted-foreground">No repositories match your search.</p>}
            </>
          )}

          {/* GitHub installation actions */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {installationUrl && <a href={installationUrl} target="_blank" rel="noreferrer" className="text-sm font-medium underline underline-offset-4">Install GitHub App / add repositories ↗</a>}
            <Button variant="outline" onClick={refreshRepositories}>Refresh repositories</Button>
          </div>
          {!installationUrl && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {installationNotice === 'installation_lookup_unavailable'
                ? 'The App installation link is temporarily unavailable. Retry shortly.'
                : 'The installation link is not configured or could not be verified. Ask the App owner for it, or ask the server administrator to check the App settings. App owners can open the App’s GitHub settings and choose Install App.'}
            </p>
          )}
        </div>
      )}

      {/* Selected repository boundary */}
      {selected && !open && <p role="status" className="mt-5 text-sm text-muted-foreground">Working in {selected.full_name}. Each repository is a separate workspace.</p>}
    </section>
  )
}
