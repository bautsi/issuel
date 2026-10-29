import { githubFetch } from './logging.ts'

type Installation = {
  id: number
  app_slug: string
  suspended_at: string | null
  permissions: Record<string, string>
}

type GitHubRepository = {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  private: boolean
  permissions?: Record<string, boolean>
}

/** Carry sanitized GitHub discovery failures without exposing provider response bodies. */
export class RepositoryError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503
  retryAfter?: number

  /** Preserve only a public code, HTTP status and optional retry delay. */
  constructor(
    code: string,
    status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    retryAfter?: number,
  ) {
    super(code)
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** Trace GitHub reads and single-attempt writes, retaining only sanitized failures. */
export async function githubResponse(
  path: string,
  accessToken: string,
  write?: {
    method: 'POST' | 'PATCH' | 'DELETE'
    body: Record<string, unknown>
  },
) {
  let response: Response
  try {
    let url = new URL(path, 'https://api.github.com')
    for (let redirects = 0; ; redirects++) {
      response = await githubFetch(url, {
        method: write?.method ?? 'GET',
        body: write ? JSON.stringify(write.body) : undefined,
        headers: {
          ...(write ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'Issuel',
        },
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
        cache: 'no-store',
      })
      if (![301, 302, 307, 308].includes(response.status)) break
      // Never replay a non-idempotent request after a redirect.
      if (write) throw new Error('Write redirected')
      const location = response.headers.get('location')
      if (!location || redirects >= 3) throw new Error('Invalid redirect')
      url = new URL(location, url)
      if (
        url.origin !== 'https://api.github.com' ||
        url.username ||
        url.password
      ) {
        throw new Error('Invalid redirect')
      }
    }
  } catch {
    throw new RepositoryError(
      write ? 'github_write_uncertain' : 'github_unavailable',
      503,
    )
  }
  const body: unknown = await response.json().catch(() => null)
  const data =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  if (response.status === 401)
    throw new RepositoryError('reauthentication_required', 401)
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after') ||
        (typeof data?.message === 'string' &&
          /rate limit|abuse detection/i.test(data.message))))
  ) {
    const retry = Number(response.headers.get('retry-after'))
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const resetDelay =
      response.headers.get('x-ratelimit-remaining') === '0' && reset > 0
        ? Math.max(1, Math.ceil(reset - Date.now() / 1000))
        : 0
    const retryAfter =
      Math.max(retry > 0 ? Math.ceil(retry) : 0, resetDelay) || 60
    throw new RepositoryError(
      'github_rate_limited',
      429,
      Number.isSafeInteger(retryAfter) ? retryAfter : 60,
    )
  }
  if (response.status === 403)
    throw new RepositoryError('github_forbidden', 403)
  if (response.status === 404)
    throw new RepositoryError('github_not_found', 404)
  if (response.status === 409)
    throw new RepositoryError('github_write_conflict', 409)
  if (response.status === 422)
    throw new RepositoryError('github_write_rejected', 422)
  if (write && !response.ok)
    throw new RepositoryError('github_write_uncertain', 503)
  if (!response.ok) throw new RepositoryError('github_unavailable', 503)
  if (!body || typeof body !== 'object') {
    throw new RepositoryError('github_invalid_response', 502)
  }
  return { data: body, link: response.headers.get('link') }
}

/** Require an object for the existing installation and repository discovery endpoints. */
async function github(path: string, accessToken: string) {
  const { data, link } = await githubResponse(path, accessToken)
  if (Array.isArray(data))
    throw new RepositoryError('github_invalid_response', 502)
  return { data: data as Record<string, unknown>, link }
}

/** Resolve mutable repository names only against a fresh App-and-user access list. */
export async function resolveWorkspace(
  accessToken: string,
  repositories: Awaited<
    ReturnType<typeof discoverRepositories>
  >['repositories'],
  owner: string,
  name: string,
  repositoryId?: string,
) {
  // History identity survives renames and name reuse, but never grants access.
  if (repositoryId !== undefined) {
    return (
      repositories.find(
        (repository) => String(repository.id) === repositoryId,
      ) ?? null
    )
  }
  const fullName = `${owner}/${name}`.toLowerCase()
  const repository = repositories.find(
    (item) => item.full_name.toLowerCase() === fullName,
  )
  if (repository) return repository
  try {
    const { data } = await github(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      accessToken,
    )
    return repositories.find((item) => item.id === data.id) ?? null
  } catch (error) {
    if (error instanceof RepositoryError && error.status === 404) return null
    throw error
  }
}

/** Enumerate every installation and repository page; return no partial authorization list. */
export async function discoverRepositories(
  accessToken: string,
  clientId: string,
) {
  const installations: Installation[] = []
  for (let page = 1; ; page++) {
    const { data, link } = await github(
      `/user/installations?per_page=100&page=${page}`,
      accessToken,
    )
    if (!Array.isArray(data.installations))
      throw new RepositoryError('github_invalid_response', 502)
    for (const installation of data.installations) {
      if (
        !installation ||
        !Number.isSafeInteger(installation.id) ||
        installation.id <= 0 ||
        typeof installation.app_slug !== 'string' ||
        !/^[a-z0-9-]+$/.test(installation.app_slug) ||
        !(
          installation.suspended_at === null ||
          typeof installation.suspended_at === 'string'
        ) ||
        !installation.permissions ||
        typeof installation.permissions !== 'object' ||
        Array.isArray(installation.permissions) ||
        !Object.values(installation.permissions).every(
          (value) => typeof value === 'string',
        )
      )
        throw new RepositoryError('github_invalid_response', 502)
      installations.push(installation)
    }
    if (!link?.includes('rel="next"')) break
  }

  const repositories = new Map<
    number,
    {
      id: number
      name: string
      full_name: string
      owner: string
      private: boolean
      permissions: Record<string, boolean>
      installations: { id: number; permissions: Record<string, string> }[]
    }
  >()
  for (const installation of installations) {
    if (installation.suspended_at !== null) continue
    for (let page = 1; ; page++) {
      const { data, link } = await github(
        `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
        accessToken,
      )
      if (!Array.isArray(data.repositories))
        throw new RepositoryError('github_invalid_response', 502)
      for (const repository of data.repositories as GitHubRepository[]) {
        if (
          !repository ||
          !Number.isSafeInteger(repository.id) ||
          repository.id <= 0 ||
          typeof repository.name !== 'string' ||
          !repository.name ||
          typeof repository.full_name !== 'string' ||
          !repository.full_name ||
          typeof repository.owner?.login !== 'string' ||
          !repository.owner.login ||
          typeof repository.private !== 'boolean' ||
          (repository.permissions !== undefined &&
            (!repository.permissions ||
              typeof repository.permissions !== 'object' ||
              Array.isArray(repository.permissions) ||
              !Object.values(repository.permissions).every(
                (value) => typeof value === 'boolean',
              )))
        )
          throw new RepositoryError('github_invalid_response', 502)
        // Project only necessary fields; upstream repository objects can contain credentials.
        const existing = repositories.get(repository.id)
        const grant = {
          id: installation.id,
          permissions: installation.permissions,
        }
        if (existing) {
          if (
            !existing.installations.some((item) => item.id === installation.id)
          )
            existing.installations.push(grant)
        } else {
          repositories.set(repository.id, {
            id: repository.id,
            name: repository.name,
            full_name: repository.full_name,
            owner: repository.owner.login,
            private: repository.private,
            permissions: repository.permissions ?? {},
            installations: [grant],
          })
        }
      }
      if (!link?.includes('rel="next"')) break
    }
  }

  // Installations identify the current app even if its installation is suspended.
  let slug = installations[0]?.app_slug
  let installationUnavailable = false
  if (!slug) {
    const configuredSlug = process.env.GITHUB_APP_SLUG?.trim()
    if (configuredSlug && /^[a-z0-9-]+$/.test(configuredSlug)) {
      try {
        const { data } = await github(
          `/apps/${encodeURIComponent(configuredSlug)}`,
          accessToken,
        )
        if (data.client_id === clientId && data.slug === configuredSlug)
          slug = configuredSlug
      } catch (error) {
        if (error instanceof RepositoryError && error.status === 401)
          throw error
        installationUnavailable = true
      }
    }
  }
  return {
    repositories: [...repositories.values()].sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    ),
    installationUrl: slug
      ? `https://github.com/apps/${slug}/installations/new`
      : null,
    installationNotice: slug
      ? null
      : installationUnavailable
        ? 'installation_lookup_unavailable'
        : 'app_slug_not_configured',
  }
}
