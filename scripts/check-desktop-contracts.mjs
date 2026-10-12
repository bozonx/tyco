#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
/** @param {string} path */
const read = (path) => readFile(resolve(root, path), 'utf8')
const lib = await read('src-tauri/src/lib.rs')
const registered = lib
  .split('tauri::generate_handler![')[1]
  .split('])')[0]
  .split(',')
  .map((entry) => entry.trim().split('::').at(-1))
  .filter(Boolean)
  .sort()
const build = await read('src-tauri/build.rs')
const guarded = Array.from(
  build
    .split('.commands(&[')[1]
    .split('])')[0]
    .matchAll(/"([a-z_]+)"/g),
  (match) => match[1]
).sort()
assert.deepEqual(
  guarded,
  registered,
  'Every registered command must be covered by AppManifest'
)
const shared = await read('packages/shared/src/desktop.ts')
const frontend = Array.from(
  shared
    .split('export const DESKTOP_COMMANDS =')[1]
    .split('} as const')[0]
    .matchAll(/'([a-z_]+)'/g),
  (match) => match[1]
)
for (const command of frontend)
  assert.ok(registered.includes(command), `Missing Rust command: ${command}`)
const granted = new Set()
for (const file of await readdir(resolve(root, 'src-tauri/capabilities'))) {
  if (!file.endsWith('.json')) continue
  const capability = JSON.parse(await read(`src-tauri/capabilities/${file}`))
  assert.ok(
    !capability.remote,
    'Remote sources must not receive desktop capabilities'
  )
  assert.ok(
    capability.windows.every((/** @type {string} */ window) =>
      ['main', 'quick'].includes(window)
    ),
    'No wildcard window capabilities'
  )
  for (const permission of capability.permissions) {
    assert.ok(
      !permission.endsWith(':default'),
      `Use explicit core permissions: ${permission}`
    )
    if (permission.startsWith('allow-')) {
      const command = permission.slice(6).replaceAll('-', '_')
      assert.ok(
        registered.includes(command),
        `Unknown permission: ${permission}`
      )
      granted.add(command)
      if (
        [
          'secrets_set',
          'secrets_remove',
          'install_plugin_package',
          'remove_plugin_package',
          'restore_plugin_package',
        ].includes(command)
      )
        assert.deepEqual(capability.windows, ['main'])
      if (
        [
          'claim_external_job',
          'finish_external_job',
          'answer_external_access',
        ].includes(command)
      )
        assert.deepEqual(capability.windows, ['quick'])
    }
  }
}
assert.deepEqual(
  [...granted].sort(),
  registered,
  'Every desktop command must have an explicit capability'
)
console.log(
  `Desktop contracts verified: ${registered.length} commands with explicit permissions`
)
