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

import {
  cargoPackageVersion,
  updateCargoVersion,
  validateVersion,
} from './lib/version-manifests.js'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

const rootPackagePath = resolve(rootDir, 'package.json')
const tauriConfigPath = resolve(rootDir, 'src-tauri/tauri.conf.json')
const cargoTomlPath = resolve(rootDir, 'src-tauri/Cargo.toml')

const version = validateVersion(
  JSON.parse(readFileSync(rootPackagePath, 'utf8')).version
)

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
  const current = cargoPackageVersion(raw)
  targets.push({
    label: 'src-tauri/Cargo.toml',
    current: current.version,
    write: () => {
      writeFileSync(cargoTomlPath, updateCargoVersion(raw, version))
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
  const actual = target.label.endsWith('.toml')
    ? cargoPackageVersion(readFileSync(cargoTomlPath, 'utf8')).version
    : JSON.parse(readFileSync(tauriConfigPath, 'utf8')).version
  if (actual !== version)
    throw new Error(`Version update failed: ${target.label}`)
  console.log(`Updated ${target.label}: ${target.current} → ${version}`)
}

if (outOfSync.length === 0) {
  console.log(`Version ${version} already in sync`)
}
