#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packages = []
for (const name of await readdir(resolve(root, 'packages'))) {
  if (!name.startsWith('plugin-') || ['plugin-sdk', 'plugin-build'].includes(name)) continue
  packages.push(JSON.parse(await readFile(resolve(root, 'packages', name, 'dist/plugin.tyco-plugin'), 'utf8')))
}
const manifest = { id: 'RuntimeProbe', version: '1.0.0', apiVersion: 2, capabilities: [], defaultLocale: 'en_US', locales: { en_US: {} } }
packages.push({ manifest, module: `export default () => ({ ...${JSON.stringify(manifest)}, async init(ctx) {
  if (typeof window !== 'undefined' || typeof document !== 'undefined' || typeof globalThis.__TAURI_INTERNALS__ !== 'undefined') throw new Error('Host globals exposed');
  let blocked = false; try { await fetch('/forbidden'); } catch { blocked = true; } if (!blocked) throw new Error('Worker network exposed');
  blocked = false; try { globalThis.eval('1'); } catch { blocked = true; } if (!blocked) throw new Error('Worker eval exposed');
  ctx.registerToolbarItems([{ id: 'hang', action: () => { while (true) {} } }]);
} })` })
let report
const completed = new Promise((resolveReport) => { report = resolveReport })
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/result' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      report(JSON.parse(body))
      response.end('ok')
      return
    }
    let body
    let type = 'application/javascript'
    if (path === '/') {
      type = 'text/html'
      body = '<!doctype html><html><body><script src="/harness.js"></script></body></html>'
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; frame-src http://127.0.0.1:*; style-src 'none'")
    } else if (path === '/harness.js') body = await readFile(resolve(root, 'scripts/plugin-runtime-browser.js'))
    else if (path === '/packages.json') {
      type = 'application/json'
      body = JSON.stringify(packages.map((item, index) => ({ manifest: item.manifest, url: `/packages/${index}.js` })))
    } else if (/^\/packages\/\d+\.js$/.test(path)) body = packages[Number(path.match(/\d+/)[0])].module
    else if (['/runtime/index.html', '/runtime/frame.js', '/runtime/worker.js'].includes(path)) {
      if (path.endsWith('.html')) type = 'text/html'
      body = await readFile(resolve(root, 'src-tauri/plugin-runtime', path.split('/').at(-1)))
      response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; connect-src 'none'; worker-src ${path.endsWith('.html') ? "'self'" : "'none'"}; object-src 'none'; base-uri 'none'; frame-src 'none'`)
    } else { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', `${type}; charset=utf-8`)
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Cache-Control', 'no-store')
    response.end(body)
  } catch (error) { response.writeHead(500).end(String(error)) }
})
await new Promise((resolveReady) => server.listen(0, '0.0.0.0', resolveReady))
const profile = await mkdtemp(resolve(tmpdir(), 'tyco-plugin-browser-'))
const browser = spawn(process.env.TYCO_TEST_BROWSER ?? 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, `http://localhost:${server.address().port}/`], { stdio: 'ignore' })
let timer
try {
  const result = await Promise.race([
    completed,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plugin browser verification timed out')), 25000); browser.on('error', reject) }),
  ])
  assert.equal(result.ok, true, result.error)
  console.log(`Isolated runtime verified in Chromium: ${result.verified.join(', ')}`)
} finally {
  clearTimeout(timer)
  browser.kill('SIGTERM')
  await new Promise((resolveExit) => browser.once('exit', resolveExit))
  await new Promise((resolveClosed) => server.close(resolveClosed))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
