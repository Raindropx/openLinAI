import './polyfills'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import dotenv from 'dotenv'
import { Hono } from 'hono'
import * as path from 'path'
import chatApi from './api/chat'
import configApi from './api/common/config'
import logApi from './api/common/log'
import staticApi from './api/common/static'
import stylePresetApi from './api/common/style-preset'
import taskApi from './api/common/task'
import templateApi from './api/common/template'
import gptImageApi from './api/gpt-image'
import styleAnalyzeApi from './api/style-analyze'
import yunwuTokenApi from './api/yunwu-token'

dotenv.config()

const app = new Hono()

const routes = app
  // module
  .route('/api/chat', chatApi)
  .route('/api/style-analyze', styleAnalyzeApi)
  .route('/api/gptImage', gptImageApi)
  .route('/api/gptImage', yunwuTokenApi)
  // common
  .route('/api/task', taskApi)
  .route('/api/template', templateApi)
  .route('/api/style-preset', stylePresetApi)
  .route('/api/log', logApi)
  .route('/api/static', staticApi)
  .route('/api/config', configApi)
export type AppType = typeof routes

export const BACKEND_PORT = process.env.PORT
  ? Number(process.env.PORT)
  : process.env.NODE_ENV !== 'development'
    ? 3000
    : 3001

if (process.env.NODE_ENV !== 'development') {
  // Production serving of static files
  const clientPath = path.resolve(__dirname, '../client')
  app.use('/*', serveStatic({ root: clientPath }))
}

serve(
  {
    fetch: app.fetch,
    port: BACKEND_PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.OPEN_BROWSER !== 'false'
    ) {
      const url = `http://localhost:${info.port}`
      const { exec } = require('child_process')
      const start =
        process.platform == 'darwin'
          ? 'open'
          : process.platform == 'win32'
            ? 'start'
            : 'xdg-open'
      exec(`${start} ${url}`)
    }
  },
)

export default app
