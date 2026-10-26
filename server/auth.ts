import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import {
  discoverRepositories,
  RepositoryError,
  resolveWorkspace,
} from './repositories.ts'
import { readIssues } from './issues.ts'
import { readIssueComments, readIssueDetail } from './issue-detail.ts'
import { defaultStatuses } from './issue-status.ts'
import { githubFetch } from './logging.ts'

const FLOW_TTL = 10 * 60_000
const SESSION_TTL = 30 * 24 * 60 * 60_000
const REFRESH_MARGIN = 60_000
const REQUEST_TIMEOUT = 10_000

type Config = {
  clientId: string
  clientSecret: string
  callback: URL
  encryptionKey: Buffer
  databasePath: string
  secure: boolean
}

type Session = {
  id_hash: string
  github_user_id: string
  access_token: string
  refresh_token: string
  access_expires_at: number
  refresh_expires_at: number
  expires_at: number
  refresh_started_at: number | null
}

type Tokens = {
  access: string
  refresh: string
  accessExpiresAt: number
  refreshExpiresAt: number
}

/** Report only an allowlisted failure code, never upstream bodies or credentials. */
class AuthError extends Error {
  status: 401 | 503

  /** Carry the public error code and HTTP status across the auth handlers. */
  constructor(code: string, status: 401 | 503 = 503) {
    super(code)
    this.status = status
  }
}

/** Validate process configuration and report invalid variable names without their values. */
export function readConfig(): Config {
  const clientId = process.env.GITHUB_APP_CLIENT_ID
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET
  const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL
  const encryptionKey = process.env.SESSION_ENCRYPTION_KEY
  const secureSetting = process.env.SESSION_COOKIE_SECURE
  if (!clientId?.trim()) throw new Error('GITHUB_APP_CLIENT_ID is required.')
  if (!clientSecret?.trim())
    throw new Error('GITHUB_APP_CLIENT_SECRET is required.')
  if (!callbackUrl?.trim())
    throw new Error('GITHUB_OAUTH_CALLBACK_URL is required.')
  if (!encryptionKey?.trim())
    throw new Error('SESSION_ENCRYPTION_KEY is required.')
  if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.',
    )
  }
  if (
    secureSetting !== undefined &&
    !['true', 'false'].includes(secureSetting)
  ) {
    throw new Error('SESSION_COOKIE_SECURE must be true or false.')
  }

  let callback: URL
  try {
    callback = new URL(callbackUrl)
  } catch {
    throw new Error(
      'GITHUB_OAUTH_CALLBACK_URL must be a valid HTTP or HTTPS callback URL.',
    )
  }
  if (
    callback.pathname !== '/api/auth/callback' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    !['http:', 'https:'].includes(callback.protocol)
  ) {
    throw new Error(
      'GITHUB_OAUTH_CALLBACK_URL must use /api/auth/callback without query, fragment or credentials.',
    )
  }
  const secure = secureSetting !== 'false'
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)
  if (
    (!secure && (!local || process.env.NODE_ENV === 'production')) ||
    (callback.protocol !== 'https:' &&
      (secure || !local || process.env.NODE_ENV === 'production'))
  ) {
    throw new Error(
      'GITHUB_OAUTH_CALLBACK_URL and SESSION_COOKIE_SECURE require HTTPS and secure cookies outside local development.',
    )
  }
  const databasePath = process.env.SQLITE_DATABASE_PATH ?? './data/auth.sqlite'
  if (!databasePath.trim() || databasePath === ':memory:') {
    throw new Error(
      'SQLITE_DATABASE_PATH must specify a persistent database file.',
    )
  }
  return {
    clientId,
    clientSecret,
    callback,
    secure,
    encryptionKey: Buffer.from(encryptionKey, 'hex'),
    databasePath: resolve(databasePath),
  }
}

/** Hash random bearer identifiers so a database read cannot recover browser cookies. */
function hash(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

/** Encrypt with a fresh GCM nonce and bind ciphertext to its row and purpose. */
function encrypt(value: string, key: Buffer, purpose: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(purpose))
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  )
}

/** Authenticate stored ciphertext before returning its plaintext to backend code. */
function decrypt(value: string, key: Buffer, purpose: string) {
  const packed = Buffer.from(value, 'base64url')
  const cipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12))
  cipher.setAAD(Buffer.from(purpose))
  cipher.setAuthTag(packed.subarray(12, 28))
  return Buffer.concat([
    cipher.update(packed.subarray(28)),
    cipher.final(),
  ]).toString('utf8')
}

/** Read a JSON object while treating malformed provider responses as temporary errors. */
async function responseObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AuthError('github_unavailable')
  }
  return data as Record<string, unknown>
}

/** Trace code/token exchanges without exposing their form fields or response bodies. */
async function exchange(
  config: Config,
  fields: Record<string, string>,
): Promise<Tokens> {
  const startedAt = Date.now()
  const response = await githubFetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...fields,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      redirect: 'error',
    },
  )
  if (response.status === 429 || response.status >= 500)
    throw new AuthError('github_unavailable')
  const data = await responseObject(response)
  if (
    [
      'bad_refresh_token',
      'invalid_grant',
      'expired_token',
      'bad_verification_code',
    ].includes(String(data.error))
  ) {
    throw new AuthError('reauthentication_required', 401)
  }
  if (!response.ok || data.error)
    throw new AuthError('github_authorization_failed')
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    typeof data.refresh_token !== 'string' ||
    !data.refresh_token ||
    data.token_type !== 'bearer' ||
    typeof data.expires_in !== 'number' ||
    !Number.isSafeInteger(data.expires_in) ||
    data.expires_in <= 0 ||
    data.expires_in > 31_536_000 ||
    typeof data.refresh_token_expires_in !== 'number' ||
    !Number.isSafeInteger(data.refresh_token_expires_in) ||
    data.refresh_token_expires_in <= 0 ||
    data.refresh_token_expires_in > 31_536_000
  )
    throw new AuthError('expiring_tokens_required')
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    accessExpiresAt: startedAt + data.expires_in * 1000,
    refreshExpiresAt: startedAt + data.refresh_token_expires_in * 1000,
  }
}

/** Trace identity reads and distinguish revocation from outages while exposing only public fields. */
async function githubUser(accessToken: string) {
  const response = await githubFetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'Issuel',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    redirect: 'error',
  })
  if (response.status === 401)
    throw new AuthError('reauthentication_required', 401)
  if (!response.ok) throw new AuthError('github_unavailable')
  const user = await responseObject(response)
  if (
    !Number.isSafeInteger(user.id) ||
    Number(user.id) <= 0 ||
    typeof user.login !== 'string' ||
    !user.login
  ) {
    throw new AuthError('github_unavailable')
  }
  return {
    id: String(user.id),
    login: user.login,
    name: typeof user.name === 'string' ? user.name : null,
  }
}

/** Mount authentication, authorized repository reads and origin protection with one SQLite connection. */
export function createAuth() {
  const app = new Hono()
  let config: Config | null = null
  try {
    config = readConfig()
  } catch {
    // Production health and SPA remain available; auth endpoints return a sanitized 503.
  }
  let database: DatabaseSync | undefined
  const repositoryAccess = new Map<
    string,
    {
      tokenHash: string
      expiresAt: number
      result: ReturnType<typeof discoverRepositories>
    }
  >()

  /** Share complete access snapshots for 30 seconds within one session and token generation. */
  async function repositoriesForSession(
    sessionId: string,
    token: string,
    refresh: boolean,
  ) {
    const now = Date.now()
    for (const [id, entry] of repositoryAccess) {
      if (entry.expiresAt <= now) repositoryAccess.delete(id)
    }
    const tokenHash = hash(token)
    const cached = repositoryAccess.get(sessionId)
    if (
      cached?.tokenHash === tokenHash &&
      (!refresh || cached.expiresAt === Infinity)
    )
      return cached.result
    if (repositoryAccess.size >= 100)
      repositoryAccess.delete(repositoryAccess.keys().next().value!)
    const entry = {
      tokenHash,
      expiresAt: Infinity,
      result: discoverRepositories(token, config!.clientId),
    }
    repositoryAccess.set(sessionId, entry)
    try {
      const discovery = await entry.result
      entry.expiresAt = Date.now() + 30_000
      return discovery
    } catch (error) {
      if (repositoryAccess.get(sessionId) === entry)
        repositoryAccess.delete(sessionId)
      throw error
    }
  }

  /** Open the auth database lazily; initialization failures stay inside sanitized handlers. */
  function db() {
    if (database) return database
    if (!config) throw new AuthError('auth_not_configured')
    mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 })
    const connection = new DatabaseSync(config.databasePath, { timeout: 5000 })
    try {
      chmodSync(config.databasePath, 0o600)
      connection.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS oauth_flows (
          state_hash TEXT PRIMARY KEY,
          browser_hash TEXT NOT NULL,
          verifier TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sessions (
          id_hash TEXT PRIMARY KEY,
          github_user_id TEXT NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          access_expires_at INTEGER NOT NULL,
          refresh_expires_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          refresh_started_at INTEGER
        ) STRICT;
        CREATE INDEX IF NOT EXISTS oauth_flows_expiry ON oauth_flows(expires_at);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      `)
      database = connection
      return database
    } catch (error) {
      connection.close()
      throw error
    }
  }

  const sessionCookie = config?.secure
    ? '__Host-issuel_session'
    : 'issuel_session'
  const flowCookie = config?.secure ? '__Host-issuel_oauth' : 'issuel_oauth'
  const cookieOptions = {
    httpOnly: true,
    secure: config?.secure ?? true,
    sameSite: 'Lax' as const,
    path: '/',
  }

  /** Remove a cookie with the same host, path and transport restrictions used to set it. */
  function clearCookie(c: Context, name: string) {
    deleteCookie(c, name, cookieOptions)
  }

  /** Accept only the exact length and alphabet of generated random identifiers. */
  function cookieId(c: Context, name: string) {
    const value = getCookie(c, name)
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
  }

  /** Delete expired auth material without storing unrelated application data. */
  function cleanup() {
    db()
      .prepare('DELETE FROM oauth_flows WHERE expires_at <= ?')
      .run(Date.now())
    db().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  }

  /** Refresh once per session across processes; abandoned rotations require a new login. */
  async function accessToken(session: Session): Promise<string> {
    if (!config) throw new AuthError('auth_not_configured')
    if (session.refresh_started_at !== null) {
      if (session.refresh_started_at <= Date.now() - 60_000) {
        db()
          .prepare(
            'DELETE FROM sessions WHERE id_hash = ? AND refresh_started_at = ?',
          )
          .run(session.id_hash, session.refresh_started_at)
        throw new AuthError('reauthentication_required', 401)
      }
      throw new AuthError('refresh_in_progress')
    }
    if (session.access_expires_at > Date.now() + REFRESH_MARGIN) {
      return decrypt(
        session.access_token,
        config.encryptionKey,
        `${session.id_hash}:access`,
      )
    }
    if (session.refresh_expires_at <= Date.now())
      throw new AuthError('reauthentication_required', 401)
    const startedAt = Date.now()
    const claimed = db()
      .prepare(
        `UPDATE sessions SET refresh_started_at = ?
      WHERE id_hash = ? AND refresh_started_at IS NULL AND access_token = ? AND expires_at > ?`,
      )
      .run(startedAt, session.id_hash, session.access_token, startedAt)
    if (!claimed.changes) throw new AuthError('refresh_in_progress')
    let rotated = false
    try {
      const tokens = await exchange(config, {
        grant_type: 'refresh_token',
        refresh_token: decrypt(
          session.refresh_token,
          config.encryptionKey,
          `${session.id_hash}:refresh`,
        ),
      })
      rotated = true
      const encryptedAccess = encrypt(
        tokens.access,
        config.encryptionKey,
        `${session.id_hash}:access`,
      )
      const saved = db()
        .prepare(
          `UPDATE sessions SET access_token = ?, refresh_token = ?,
        access_expires_at = ?, refresh_expires_at = ?, refresh_started_at = NULL
        WHERE id_hash = ? AND refresh_started_at = ? AND expires_at > ?`,
        )
        .run(
          encryptedAccess,
          encrypt(
            tokens.refresh,
            config.encryptionKey,
            `${session.id_hash}:refresh`,
          ),
          tokens.accessExpiresAt,
          tokens.refreshExpiresAt,
          session.id_hash,
          startedAt,
          Date.now(),
        )
      if (!saved.changes) throw new AuthError('reauthentication_required', 401)
      session.access_token = encryptedAccess
      return tokens.access
    } finally {
      // Preserve the claim if rotation succeeded but persistence failed: never reuse that refresh token.
      if (!rotated)
        db()
          .prepare(
            'UPDATE sessions SET refresh_started_at = NULL WHERE id_hash = ? AND refresh_started_at = ?',
          )
          .run(session.id_hash, startedAt)
    }
  }

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    // Every future unsafe API route inherits this exact configured-origin check.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (!config) return c.json({ error: 'auth_not_configured' }, 503)
      if (
        c.req.header('Origin') !== config.callback.origin ||
        c.req.header('Sec-Fetch-Site') === 'cross-site'
      ) {
        return c.json({ error: 'invalid_origin' }, 403)
      }
    }
    await next()
  })

  app.use('/auth/*', async (c, next) => {
    if (!config) return c.json({ error: 'auth_not_configured' }, 503)
    await next()
  })

  app.onError((error, c) => {
    if (error instanceof RepositoryError) {
      if (error.retryAfter) c.header('Retry-After', String(error.retryAfter))
      return c.json(
        { error: error.message, retryAfter: error.retryAfter },
        error.status,
      )
    }
    const failure =
      error instanceof AuthError
        ? error
        : new AuthError('authentication_unavailable')
    if (failure.status === 503) c.header('Retry-After', '5')
    return c.json({ error: failure.message }, failure.status)
  })

  app.post('/auth/login', (c) => {
    if (!config) throw new AuthError('auth_not_configured')
    cleanup()
    const previousBrowser = cookieId(c, flowCookie)
    if (previousBrowser)
      db()
        .prepare('DELETE FROM oauth_flows WHERE browser_hash = ?')
        .run(hash(previousBrowser))
    const state = randomBytes(32).toString('base64url')
    const browser = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    db()
      .prepare('INSERT INTO oauth_flows VALUES (?, ?, ?, ?)')
      .run(
        hash(state),
        hash(browser),
        encrypt(verifier, config.encryptionKey, `${hash(state)}:pkce`),
        Date.now() + FLOW_TTL,
      )
    setCookie(c, flowCookie, browser, {
      ...cookieOptions,
      maxAge: FLOW_TTL / 1000,
    })
    const authorization = new URL('https://github.com/login/oauth/authorize')
    authorization.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callback.href,
      state,
      prompt: 'select_account',
      scope: 'offline_access',
      code_challenge: hash(verifier),
      code_challenge_method: 'S256',
    }).toString()
    return c.redirect(authorization.href, 303)
  })

  app.get('/auth/callback', async (c) => {
    if (!config) throw new AuthError('auth_not_configured')
    clearCookie(c, flowCookie)
    try {
      const state = c.req.queries('state')
      const browser = cookieId(c, flowCookie)
      if (
        !state ||
        state.length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(state[0]) ||
        !browser
      ) {
        return c.redirect('/?auth_error=invalid_oauth_flow', 303)
      }
      // DELETE RETURNING consumes the browser-bound flow atomically before any network call.
      const flow = db()
        .prepare(
          `DELETE FROM oauth_flows
        WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING verifier`,
        )
        .get(hash(state[0]), hash(browser), Date.now()) as
        { verifier: string } | undefined
      if (!flow) return c.redirect('/?auth_error=invalid_oauth_flow', 303)
      if (c.req.query('error'))
        return c.redirect('/?auth_error=authorization_denied', 303)
      const codes = c.req.queries('code')
      if (!codes || codes.length !== 1 || !codes[0] || codes[0].length > 1024) {
        return c.redirect('/?auth_error=invalid_oauth_flow', 303)
      }
      const tokens = await exchange(config, {
        code: codes[0],
        redirect_uri: config.callback.href,
        code_verifier: decrypt(
          flow.verifier,
          config.encryptionKey,
          `${hash(state[0])}:pkce`,
        ),
      })
      const user = await githubUser(tokens.access)
      const id = randomBytes(32).toString('base64url')
      const idHash = hash(id)
      const expiresAt = Math.min(
        Date.now() + SESSION_TTL,
        tokens.refreshExpiresAt,
      )
      const previousId = cookieId(c, sessionCookie)
      db().exec('BEGIN IMMEDIATE')
      try {
        if (previousId)
          db()
            .prepare('DELETE FROM sessions WHERE id_hash = ?')
            .run(hash(previousId))
        db()
          .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
          .run(
            idHash,
            user.id,
            encrypt(tokens.access, config.encryptionKey, `${idHash}:access`),
            encrypt(tokens.refresh, config.encryptionKey, `${idHash}:refresh`),
            tokens.accessExpiresAt,
            tokens.refreshExpiresAt,
            expiresAt,
          )
        db().exec('COMMIT')
      } catch (error) {
        db().exec('ROLLBACK')
        throw error
      }
      setCookie(c, sessionCookie, id, {
        ...cookieOptions,
        maxAge: Math.floor((expiresAt - Date.now()) / 1000),
      })
      cleanup()
      return c.redirect('/', 303)
    } catch {
      return c.redirect('/?auth_error=authorization_failed', 303)
    }
  })

  app.on(
    'GET',
    [
      '/auth/session',
      '/repositories',
      '/workspaces/:owner/:repo',
      '/repositories/:repositoryId/issues',
      '/repositories/:repositoryId/issues/:number',
      '/repositories/:repositoryId/issues/:number/comments',
    ],
    async (c) => {
      if (!config) throw new AuthError('auth_not_configured')
      const id = cookieId(c, sessionCookie)
      if (!id) {
        clearCookie(c, sessionCookie)
        return c.json({ error: 'unauthorized' }, 401)
      }
      cleanup()
      const idHash = hash(id)
      const session = db()
        .prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?')
        .get(idHash, Date.now()) as Session | undefined
      if (!session) {
        clearCookie(c, sessionCookie)
        return c.json({ error: 'unauthorized' }, 401)
      }
      try {
        const token = await accessToken(session)
        const owner = c.req.param('owner')
        const repo = c.req.param('repo')
        const repositoryId = c.req.param('repositoryId')
        const issueNumber = c.req.param('number')
        let result
        let status: 200 | 404 = 200
        if (repositoryId) {
          const state = c.req.query('state') ?? 'open'
          const page = c.req.query('page') ?? '1'
          const perPage =
            c.req.query('per_page') ?? (state === 'closed' ? '10' : '100')
          const requestedCategory = c.req.query('category')
          const category = defaultStatuses.find(
            (status) =>
              status.id === (requestedCategory ?? 'done') &&
              status.state === 'closed',
          )
          if (
            !/^[1-9]\d*$/.test(repositoryId) ||
            !Number.isSafeInteger(Number(repositoryId)) ||
            (issueNumber !== undefined &&
              (!/^[1-9]\d*$/.test(issueNumber) ||
                !Number.isSafeInteger(Number(issueNumber)))) ||
            (state !== 'open' && state !== 'closed') ||
            !/^[1-9]\d*$/.test(page) ||
            !Number.isSafeInteger(Number(page)) ||
            !/^[1-9]\d*$/.test(perPage) ||
            Number(perPage) > 100 ||
            (state === 'open' ? requestedCategory !== undefined : !category) ||
            (state === 'closed' &&
              (Number(page) - 1) * Number(perPage) >= 1000) ||
            ['state', 'page', 'per_page', 'category'].some(
              (parameter) => (c.req.queries(parameter)?.length ?? 0) > 1,
            )
          )
            return c.json({ error: 'invalid_issue_parameters' }, 400)
          const discovery = await repositoriesForSession(idHash, token, false)
          const repository = discovery.repositories.find(
            (item) => String(item.id) === repositoryId,
          )
          if (!repository) return c.json({ error: 'workspace_not_found' }, 404)
          if (
            !repository.installations.some((installation) =>
              ['read', 'write'].includes(installation.permissions.issues),
            )
          ) {
            return c.json({ error: 'github_forbidden' }, 403)
          }
          if (issueNumber !== undefined) {
            if (c.req.path.endsWith('/comments')) {
              result = {
                ...(await readIssueComments(
                  token, repository.id, Number(issueNumber), Number(page), Number(perPage),
                )),
                userId: session.github_user_id,
                repositoryId: repository.id,
                number: Number(issueNumber),
              }
            } else {
              result = {
                issue: await readIssueDetail(token, repository.id, Number(issueNumber)),
                userId: session.github_user_id,
                repositoryId: repository.id,
              }
            }
          } else {
            const issues = await readIssues(
              token,
              repository,
              state,
              Number(page),
              Number(perPage),
              state === 'closed' && category?.state === 'closed'
                ? category.id
                : undefined,
            )
            result = {
              ...issues,
              userId: session.github_user_id,
              repositoryId: repository.id,
              state,
            }
          }
        } else if ((owner && repo) || c.req.path.endsWith('/repositories')) {
          const discovery = await repositoriesForSession(
            idHash,
            token,
            c.req.path.endsWith('/repositories'),
          )
          result = { ...discovery, userId: session.github_user_id }
          if (owner && repo) {
            const repository = await resolveWorkspace(
              token,
              discovery.repositories,
              owner,
              repo,
              c.req.query('repositoryId'),
            )
            result = {
              ...result,
              repository,
              error: repository ? null : 'workspace_not_found',
            }
            if (!repository) status = 404
          }
        } else {
          const user = await githubUser(token)
          if (user.id !== session.github_user_id)
            throw new AuthError('reauthentication_required', 401)
          result = { user, expiresAt: session.expires_at }
        }
        // Logout or expiry during an upstream request must not restore a session in the response.
        if (
          !db()
            .prepare(
              'SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > ?',
            )
            .get(idHash, Date.now())
        ) {
          throw new AuthError('unauthorized', 401)
        }
        return c.json(result, status)
      } catch (error) {
        if (
          error instanceof RepositoryError &&
          [401, 403, 404].includes(error.status)
        )
          repositoryAccess.delete(idHash)
        if (
          (error instanceof AuthError || error instanceof RepositoryError) &&
          error.status === 401
        ) {
          // An older request may receive 401 after another request has rotated its token.
          const removed = db()
            .prepare(
              `DELETE FROM sessions
          WHERE id_hash = ? AND access_token = ? AND refresh_started_at IS NULL`,
            )
            .run(idHash, session.access_token)
          if (
            !removed.changes &&
            db()
              .prepare(
                'SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > ?',
              )
              .get(idHash, Date.now())
          ) {
            throw new AuthError('refresh_in_progress')
          }
          clearCookie(c, sessionCookie)
        }
        throw error
      }
    },
  )

  app.post('/auth/logout', (c) => {
    const id = cookieId(c, sessionCookie)
    if (id) repositoryAccess.delete(hash(id))
    if (id) db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(id))
    const browser = cookieId(c, flowCookie)
    if (browser)
      db()
        .prepare('DELETE FROM oauth_flows WHERE browser_hash = ?')
        .run(hash(browser))
    clearCookie(c, sessionCookie)
    clearCookie(c, flowCookie)
    return c.body(null, 204)
  })

  return app
}
