#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import { run } from '@tauri-apps/cli'

import { createDevConfig, parseDevPort } from './lib/dev-config.js'

const root = resolve(import.meta.dirname, '..')
const platforms = { linux: 'linux', darwin: 'macos', win32: 'windows' }
const platform =
  platforms[/** @type {keyof typeof platforms} */ (process.platform)]
if (!platform)
  throw new Error(`Unsupported development platform: ${process.platform}`)

const port = parseDevPort(process.env.PORT)
process.env.PORT = String(port)
process.env.TYCO_DEV_HOME ||= resolve(root, 'dev_files', platform)
if (!isAbsolute(process.env.TYCO_DEV_HOME)) {
  throw new Error('TYCO_DEV_HOME must be an absolute path')
}

if (platform === 'linux') {
  const source = await readFile(
    resolve(root, 'scripts/dev-data/applications/com.tyco.app.desktop'),
    'utf8'
  )
  const directory = resolve(
    process.env.XDG_DATA_HOME || resolve(homedir(), '.local/share'),
    'applications'
  )
  const target = resolve(directory, 'com.tyco.app.desktop')
  const existing = await readFile(target, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (
    existing === undefined ||
    (/^X-Tyco-Development=true$/m.test(existing) && existing !== source)
  ) {
    await mkdir(directory, { recursive: true })
    await writeFile(target, source, { mode: 0o644 })
  }
}

const config = JSON.parse(
  await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')
)
process.chdir(root)
await run(
  [
    'dev',
    '--config',
    JSON.stringify(createDevConfig(config.app.security.csp, port)),
    // the benchmark socket is built only on request, see `activation-bench`
    ...(process.env.TYCO_ACTIVATION_BENCH === '1'
      ? ['--features', 'activation-bench']
      : []),
    ...process.argv.slice(2),
  ],
  'pnpm tauri:dev'
)
