import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

const requests = new AsyncLocalStorage<{
  requestId: string
  githubRequests: number
}>()

/** Retain paths and validated issue pagination without logging OAuth queries or arbitrary values. */
function logTarget(input: string | URL) {
  const url = new URL(input)
  const pagination: Record<string, string> = {}
  if (url.pathname.endsWith('/issues') || /\/issues\/[1-9]\d*\/comments$/.test(url.pathname)) {
    for (const name of ['page', 'per_page']) {
      const value = url.searchParams.get(name)
      if (value && /^[1-9]\d{0,15}$/.test(value)) pagination[name] = value
    }
    const state = url.searchParams.get('state')
    if (state === 'open' || state === 'closed') pagination.state = state
    const category = url.searchParams.get('category')
    if (
      category === 'done' ||
      category === 'canceled' ||
      category === 'duplicate'
    )
      pagination.category = category
  }
  return { path: url.pathname, ...pagination }
}

/** Correlate API requests and their GitHub calls without trusting an incoming request ID. */
export const requestLogging: MiddlewareHandler = async (c, next) => {
  const context = { requestId: randomUUID(), githubRequests: 0 }
  const target = logTarget(c.req.url)
  const startedAt = performance.now()
  c.header('X-Request-ID', context.requestId)
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'http.request',
      requestId: context.requestId,
      method: c.req.method,
      ...target,
    }),
  )
  await requests.run(context, async () => {
    let failed = false
    try {
      await next()
    } catch (error) {
      failed = true
      throw error
    } finally {
      console.info(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'http.response',
          requestId: context.requestId,
          method: c.req.method,
          ...target,
          status: failed ? 500 : c.res.status,
          durationMs: Math.round(performance.now() - startedAt),
          githubAccessed: context.githubRequests > 0,
          githubRequests: context.githubRequests,
        }),
      )
    }
  })
}

/** Trace each GitHub fetch attempt, including redirects and network failures, without headers or bodies. */
export async function githubFetch(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const context = requests.getStore()
  if (context) context.githubRequests++
  const target = { host: new URL(input).hostname, ...logTarget(input) }
  const requestId = context?.requestId ?? null
  const method = init.method ?? 'GET'
  const startedAt = performance.now()
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'github.request',
      requestId,
      method,
      ...target,
    }),
  )
  try {
    const response = await fetch(input, init)
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'github.response',
        requestId,
        method,
        ...target,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    )
    return response
  } catch (error) {
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'github.error',
        requestId,
        method,
        ...target,
        error: 'network_error',
        durationMs: Math.round(performance.now() - startedAt),
      }),
    )
    throw error
  }
}
