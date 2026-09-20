#!/usr/bin/env node
/**
 * Keeps the app version in a single place. The root package.json is the source
 * of truth; src-tauri/tauri.conf.json and src-tauri/Cargo.toml follow it.
 *
 * Usage: node scripts/sync-version.js write the version into both targets node
 * scripts/sync-version.js --check fail if any target is out of sync
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

const rootPackagePath = resolve(rootDir, 'package.json')
const tauriConfigPath = resolve(rootDir, 'src-tauri/tauri.conf.json')
const cargoTomlPath = resolve(rootDir, 'src-tauri/Cargo.toml')

const version = JSON.parse(readFileSync(rootPackagePath, 'utf8')).version

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version in package.json: ${version}`)
  process.exit(1)
}

/**
 * @type {{
 *   label: string
 *   current: string | undefined
 *   write: () => void
 * }[]}
 */
const targets = []

{
  const raw = readFileSync(tauriConfigPath, 'utf8')
  const config = JSON.parse(raw)
  targets.push({
    label: 'src-tauri/tauri.conf.json',
    current: config.version,
    write: () => {
      config.version = version
      writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`)
    },
  })
}

{
  const raw = readFileSync(cargoTomlPath, 'utf8')
  // Only the `version` key of the [package] section, which comes first.
  const match = raw.match(/^version = "([^"]+)"$/m)
  targets.push({
    label: 'src-tauri/Cargo.toml',
    current: match?.[1],
    write: () => {
      writeFileSync(
        cargoTomlPath,
        raw.replace(/^version = "[^"]+"$/m, `version = "${version}"`)
      )
    },
  })
}

const outOfSync = targets.filter((target) => target.current !== version)

if (checkOnly) {
  if (outOfSync.length > 0) {
    console.error(`Version mismatch (package.json is ${version}):`)
    for (const target of outOfSync) {
      console.error(`  ${target.label}: ${target.current}`)
    }
    console.error('\nRun `pnpm sync:version` to fix.')
    process.exit(1)
  }

  console.log(`✅ Version ${version} is in sync across all manifests`)
  process.exit(0)
}

for (const target of outOfSync) {
  target.write()
  console.log(`Updated ${target.label}: ${target.current} → ${version}`)
}

if (outOfSync.length === 0) {
  console.log(`Version ${version} already in sync`)
}
