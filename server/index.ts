import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createAuth } from './auth.ts'
import { requestLogging } from './logging.ts'

const app = new Hono()

app.use('/api/*', requestLogging)
app.route('/api', createAuth())
app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

app.use('*', serveStatic({ root: './dist/client' }))
app.get('/assets/*', (c) => c.notFound())
app.get('*', async (c, next) => {
  if (!c.req.header('Accept')?.includes('text/html')) return c.notFound()
  return (
    (await serveStatic({ path: './dist/client/index.html' })(c, next)) ??
    c.notFound()
  )
})

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Issuel server listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
