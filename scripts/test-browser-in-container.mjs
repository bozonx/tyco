#!/usr/bin/env node
// Runs the browser tests in the Playwright image CI uses. Its WebKit build
// needs the libraries of Ubuntu 24.04, and the visual baselines belong to its
// Chromium, so only this run is comparable with CI on any Linux.
//
//   pnpm test:browser:container
//   pnpm test:browser:container -g @visual --update-snapshots
//
// Arguments go to `playwright test`.
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { userInfo } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(
  await readFile(resolve(root, 'apps/desktop-ui/package.json'), 'utf8')
)
const version = manifest.devDependencies['@playwright/test']
const image = `mcr.microsoft.com/playwright:v${version}-noble`
const { uid, gid } = userInfo()
const args = process.argv
  .slice(2)
  .filter((arg) => arg !== '--')
  .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
  .join(' ')

const script = [
  'mkdir -p "$HOME/bin"',
  'corepack enable --install-directory "$HOME/bin"',
  'export PATH="$HOME/bin:$PATH"',
  'pnpm build:plugins',
  `pnpm --filter @tyco/desktop-ui exec playwright test ${args}`,
].join(' && ')

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    // files written into the checkout stay the user's
    ...(uid >= 0 ? ['--user', `${uid}:${gid}`] : []),
    '--env',
    'HOME=/tmp/home',
    '--env',
    'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    '--volume',
    `${root}:${root}`,
    '--workdir',
    root,
    image,
    'bash',
    '-c',
    script,
  ],
  { stdio: 'inherit' }
)
process.exit(result.status ?? 1)
