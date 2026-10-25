import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Navigate,
  useLocation,
  useMatch,
  useNavigate,
} from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Workspace } from '@/components/workspace'
import { IssueReadError } from '@/lib/issues'

type Repository = {
  id: number
  name: string
  full_name: string
  owner: string
  private: boolean
}

/** Resolve routes from a shared user-scoped discovery cache; protected reads still verify access. */
export function WorkspaceSelector({
  userId,
  onSessionExpired,
}: {
  userId: string
  onSessionExpired: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const match = useMatch('/workspace/:owner/:repo')
  const owner = match?.params.owner
  const name = match?.params.repo
  const historyId =
    location.state?.userId === userId &&
    Number.isSafeInteger(location.state?.repositoryId)
      ? String(location.state.repositoryId)
      : undefined
  const routeIdentity = JSON.stringify([location.pathname, historyId])
  const storageKey = `issuel:workspace:${userId}`
  const [preference] = useState(() => {
    try {
      return { id: window.localStorage.getItem(storageKey), unavailable: false }
    } catch {
      return { id: null, unavailable: true }
    }
  })
  const [{ id: selectedId, revoked }, setSelection] = useState({
    id: preference.id,
    revoked: false,
  })
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [pending, setLoading] = useState(true)
  const [loadedRoute, setLoadedRoute] = useState<string | null>(null)
  const loading = pending || loadedRoute !== routeIdentity
  const [error, setError] = useState<string | null>(null)
  const [storageUnavailable, setStorageUnavailable] = useState(
    preference.unavailable,
  )
  const [installationUrl, setInstallationUrl] = useState<string | null>(null)
  const [installationNotice, setInstallationNotice] = useState<string | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let controller: AbortController | undefined

    /** Reuse discovery across navigation and discard obsolete route resolutions. */
    async function loadRepositories() {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      setLoading(true)
      setError(null)
      try {
        const discovery = await client.fetchQuery({
          queryKey: ['github', userId, 'repositories'],
          staleTime: Infinity,
          gcTime: Infinity,
          queryFn: async () => {
            const response = await fetch('/api/repositories', {
              cache: 'no-store',
            })
            const data = await response.json()
            if (response.status === 401)
              throw new IssueReadError(
                'Your session has expired. Connect GitHub again.',
                401,
              )
            if (!response.ok) {
              const messages: Record<string, string> = {
                github_forbidden:
                  'GitHub denied repository access. Check the App permissions and organization approval, then retry.',
                github_not_found:
                  'A GitHub installation is no longer accessible. Check App access, then retry.',
                github_rate_limited:
                  'GitHub rate limit reached. Please wait before retrying.',
                auth_not_configured:
                  'GitHub authentication is not configured on the server.',
                refresh_in_progress:
                  'Your session is being refreshed. Please retry shortly.',
              }
              throw new IssueReadError(
                messages[data.error] ??
                  'Unable to load repositories from GitHub. Please retry shortly.',
                response.status,
                Number(response.headers.get('Retry-After')) || 0,
              )
            }
            if (data.userId !== userId || !Array.isArray(data.repositories)) {
              throw new IssueReadError(
                'Your GitHub session changed. Connect GitHub again.',
                401,
              )
            }
            return data as {
              userId: string
              repositories: Repository[]
              installationUrl: string | null
              installationNotice: string | null
            }
          },
        })
        if (signal.aborted) return
        const repository =
          owner && name
            ? (discovery.repositories.find((item) =>
                historyId
                  ? String(item.id) === historyId
                  : item.full_name.toLowerCase() === `${owner}/${name}`.toLowerCase(),
              ) ?? null)
            : null
        let data = { ...discovery, repository }
        // Unknown name-only links still use the server's rename resolution and access check.
        if (owner && name && !historyId && !repository) {
          data = await client.fetchQuery({
            queryKey: ['github', userId, 'workspace', owner, name],
            staleTime: Infinity,
            gcTime: Infinity,
            queryFn: async () => {
              const response = await fetch(
                `/api/workspaces/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
                { cache: 'no-store' },
              )
              const data = await response.json()
              if (
                !response.ok &&
                !(response.status === 404 && data.error === 'workspace_not_found')
              )
                throw new IssueReadError(
                  response.status === 429
                    ? 'GitHub rate limit reached. Please wait before retrying.'
                    : 'Unable to load repositories from GitHub. Please retry shortly.',
                  response.status,
                )
              if (data.userId !== userId)
                throw new IssueReadError(
                  'Your GitHub session changed. Connect GitHub again.',
                  401,
                )
              if (!Array.isArray(data.repositories))
                throw new Error('Unable to load repositories. Please retry.')
              return data as typeof discovery & { repository: Repository | null }
            },
          })
          client.setQueryData(['github', userId, 'repositories'], data)
        }
        if (signal.aborted) return
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
        if (
          savedId &&
          !data.repositories.some(
            (repository: Repository) => String(repository.id) === savedId,
          )
        ) {
          try {
            window.localStorage.removeItem(storageKey)
          } catch {
            setStorageUnavailable(true)
          }
        }
        setSelection((current) => {
          const id =
            owner && name
              ? data.repository
                ? String(data.repository.id)
                : null
              : (savedId ?? current.id)
          return id &&
            !data.repositories.some(
              (repository: Repository) => String(repository.id) === id,
            )
            ? { id: null, revoked: true }
            : {
                id,
                revoked:
                  !!(owner && name && !data.repository) || (!id && !!savedId),
              }
        })
        if (owner && name && data.repository) {
          try {
            window.localStorage.setItem(storageKey, String(data.repository.id))
          } catch {
            setStorageUnavailable(true)
          }
        }
      } catch (failure) {
        if (
          !signal.aborted &&
          failure instanceof IssueReadError &&
          failure.status === 401
        ) {
          onSessionExpired()
          return
        }
        if (!signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load repositories. Please retry.',
          )
      } finally {
        if (!signal.aborted) {
          setLoadedRoute(routeIdentity)
          setLoading(false)
        }
      }
    }

    void loadRepositories()
    return () => {
      controller?.abort()
    }
  }, [
    userId,
    client,
    storageKey,
    revision,
    onSessionExpired,
    owner,
    name,
    historyId,
    routeIdentity,
  ])

  const selected =
    !loading && !error
      ? repositories.find((repository) => String(repository.id) === selectedId)
      : undefined
  const filtered = repositories.filter((repository) =>
    repository.full_name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  /** Navigate by stable repository identity while reusing already loaded issue queries. */
  function selectRepository(repository: Repository) {
    if (
      loading ||
      error ||
      !repositories.some((item) => item.id === repository.id)
    )
      return
    setSearch('')
    navigate(
      `/workspace/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      {
        state: { userId, repositoryId: repository.id },
      },
    )
  }

  /** Invalidate only discovery and name resolution, preserving every repository's issue cache. */
  async function refreshRepositories() {
    if (pending) return
    setLoading(true)
    await Promise.all([
      client.invalidateQueries({
        queryKey: ['github', userId, 'repositories'],
        exact: true,
      }),
      client.invalidateQueries({ queryKey: ['github', userId, 'workspace'] }),
    ])
    setRevision((current) => current + 1)
  }

  const workspacePath = selected
    ? `/workspace/${encodeURIComponent(selected.owner)}/${encodeURIComponent(selected.name)}`
    : null
  if (
    selected &&
    workspacePath &&
    (location.pathname === '/' ||
      (match &&
        (location.pathname !== workspacePath ||
          historyId !== String(selected.id))))
  ) {
    return (
      <Navigate
        to={workspacePath}
        replace
        state={{ userId, repositoryId: selected.id }}
      />
    )
  }

  return (
    <div className="grid min-h-[calc(100svh-3.5rem)] md:grid-cols-[13.5rem_minmax(0,1fr)]">
      {/* Persistent repository navigation */}
      <aside
        aria-labelledby="workspace-heading"
        aria-busy={loading}
        className="flex min-w-0 flex-col border-b bg-card/40 p-3 md:sticky md:top-14 md:h-[calc(100svh-3.5rem)] md:border-r md:border-b-0"
      >
        <div className="flex items-center justify-between px-2">
          <h2
            id="workspace-heading"
            className="text-xs font-medium text-muted-foreground"
          >
            {t('Repositories')}
          </h2>
          <Button
            variant="outline"
            aria-label={t('Refresh repositories')}
            title={t('Refresh repositories')}
            onClick={refreshRepositories}
            disabled={loading}
            className="size-7 border-transparent bg-transparent p-0 text-muted-foreground shadow-none"
          >
            <svg
              aria-hidden="true"
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
            </svg>
          </Button>
        </div>

        {/* Loading, discovery errors and access changes */}
        {loading && repositories.length === 0 && (
          <div role="status" className="mt-3 flex min-h-0 flex-1 flex-col">
            <span className="sr-only">{t('Loading repositories…')}</span>
            <Skeleton className="mx-1 h-8 shrink-0" />
            <div className="mt-2 space-y-0.5">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="flex min-h-11 items-center gap-2.5 border border-transparent px-2 py-2"
                >
                  <Skeleton className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex h-4 items-center">
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                    <div className="flex h-4 items-center">
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 px-2">
            <p role="alert" className="text-xs leading-5 text-destructive">
              {t(error)}
            </p>
            <Button
              className="mt-3 h-8 text-xs"
              variant="outline"
              onClick={refreshRepositories}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {revoked && !loading && (
          <p
            role="alert"
            className="mt-3 px-2 text-xs leading-5 text-destructive"
          >
            {t(
              'Repository unavailable or access revoked. Choose another repository.',
            )}
          </p>
        )}

        {/* Available repositories are always one click away */}
        {!error && repositories.length > 0 && (
          <nav
            aria-label={t('Repository workspaces')}
            className="mt-3 flex min-h-0 flex-1 flex-col"
          >
            <label htmlFor="repository-search" className="sr-only">
              {t('Search repositories')}
            </label>
            <input
              id="repository-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Find a repository…')}
              className="mx-1 h-8 min-h-8 rounded-md border bg-background/60 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto md:max-h-none">
              {filtered.map((repository) => {
                const active =
                  String(repository.id) === (historyId ?? selectedId)
                return (
                  <li key={repository.id}>
                    <Button
                      variant="outline"
                      onClick={() => selectRepository(repository)}
                      disabled={loading}
                      aria-current={active ? 'page' : undefined}
                      title={repository.full_name}
                      className={`h-auto min-h-11 w-full justify-start gap-2.5 border-transparent px-2 py-2 text-left shadow-none ${active ? 'bg-accent' : 'bg-transparent'}`}
                    >
                      <svg
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 19V5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14M8 3v14" />
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {repository.name}
                        </span>
                        <span className="block truncate text-[11px] font-normal text-muted-foreground">
                          {repository.owner}
                        </span>
                      </span>
                      {repository.private && (
                        <span
                          className="text-muted-foreground"
                          title={t('Private repository')}
                        >
                          <span className="sr-only">
                            {t('Private repository')}
                          </span>
                          <svg
                            aria-hidden="true"
                            className="size-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="5" y="10" width="14" height="11" rx="2" />
                            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                          </svg>
                        </span>
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
            {filtered.length === 0 && (
              <p
                role="status"
                className="px-2 py-4 text-xs text-muted-foreground"
              >
                {t('No matching repositories.')}
              </p>
            )}
          </nav>
        )}
        {!loading && !error && repositories.length === 0 && (
          <div className="mt-4 px-2 text-xs leading-5">
            <p className="font-medium">{t('No repositories yet')}</p>
            <p className="mt-2 text-muted-foreground">
              {t(
                'Install the GitHub App and grant repository access, then refresh this list.',
              )}
            </p>
          </div>
        )}

        {/* Repository access setup and local preference notices */}
        <div className="mt-4 space-y-3 border-t px-2 pt-3 md:mt-auto">
          {storageUnavailable && (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              {t(
                'Browser storage is unavailable. Your workspace choice will only be kept for this visit.',
              )}
            </p>
          )}
          {installationUrl && (
            <a
              href={installationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('Add repositories ↗')}
            </a>
          )}
          {!loading &&
            !error &&
            !installationUrl &&
            repositories.length === 0 && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t(
                  installationNotice === 'installation_lookup_unavailable'
                    ? 'The installation link is temporarily unavailable. Refresh to retry.'
                    : 'Ask the App owner for an installation link.',
                )}
              </p>
            )}
        </div>
      </aside>

      {/* Verify access before displaying repository content */}
      <main className="min-w-0 p-5 sm:p-6 lg:p-8" aria-busy={loading}>
        {loading ? (
          <div role="status">
            <span className="sr-only">{t('Loading workspace…')}</span>
            <div aria-hidden="true">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-3 h-8 w-56 max-w-full" />
              <Skeleton className="mt-3 h-5 w-48" />

              {/* Keep one loading region until real issue groups are available */}
              <div className="mt-8 overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                  <span className="font-semibold">{t('Issues')}</span>
                  <Skeleton className="h-8 w-40" />
                </div>
                <div className="flex min-h-72 flex-col items-center justify-center gap-4 border-t">
                  <span className="relative block h-0.5 w-12 overflow-hidden rounded-full bg-foreground/10">
                    <span className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-foreground/50 motion-safe:animate-[issuel-loading_1.6s_ease-in-out_infinite]" />
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t('Loading workspace…')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : error ? (
          <h1 className="text-xl font-semibold">
            {t('Workspace unavailable')}
          </h1>
        ) : location.pathname !== '/' && !match ? (
          <div>
            <h1 className="text-xl font-semibold">{t('Page not found')}</h1>
            <Link to="/" className="mt-4 inline-block underline">
              {t('Choose a workspace')}
            </Link>
          </div>
        ) : selected && match ? (
          <Workspace
            key={`${userId}:${selected.id}`}
            userId={userId}
            repository={selected}
            onSessionExpired={onSessionExpired}
          />
        ) : (
          <div>
            <h1 className="text-xl font-semibold">
              {t(
                match
                  ? 'Repository not found or not authorized'
                  : 'Choose a repository',
              )}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t(
                match
                  ? 'This workspace is unavailable to your GitHub account and App. Choose another repository or update App access.'
                  : 'Choose a repository from the sidebar to open its issues.',
              )}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
