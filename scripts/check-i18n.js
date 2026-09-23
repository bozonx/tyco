#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const localesDir = path.join(
  __dirname,
  '../apps/desktop-ui/src/lib/i18n/locales'
)
const localeFiles = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith('.json'))

if (localeFiles.length === 0) {
  console.error('❌ No locale files found in', localesDir)
  process.exit(1)
}

/**
 * Flattens a locale object into dot-separated key paths.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function getAllKeys(obj, prefix = '') {
  /** @type {string[]} */
  const keys = []
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (
      typeof obj[key] === 'object' &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      keys.push(
        ...getAllKeys(
          /** @type {Record<string, unknown>} */ (obj[key]),
          fullKey
        )
      )
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

const baseLocale = 'en_US.json'
if (!localeFiles.includes(baseLocale)) {
  console.error(`❌ Base locale ${baseLocale} not found.`)
  process.exit(1)
}

const baseData = JSON.parse(
  fs.readFileSync(path.join(localesDir, baseLocale), 'utf8')
)
const baseKeys = getAllKeys(baseData).sort()

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {unknown}
 */
function getValue(source, key) {
  /** @type {unknown} */
  let value = source
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = /** @type {Record<string, unknown>} */ (value)[part]
  }
  return value
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function getPlaceholders(value) {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]).sort()
}

console.log(`Base locale (${baseLocale}) total keys:`, baseKeys.length)

let hasErrors = false

for (const file of localeFiles) {
  if (file === baseLocale) continue

  const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'))
  const keys = getAllKeys(data).sort()
  const missingInFile = baseKeys.filter((k) => !keys.includes(k))
  const extraInFile = keys.filter((k) => !baseKeys.includes(k))

  console.log(`Checking ${file}: ${keys.length} keys`)

  if (missingInFile.length > 0) {
    hasErrors = true
    console.error(`\n❌ Missing in ${file}:`)
    missingInFile.forEach((k) => console.error('  -', k))
  }

  if (extraInFile.length > 0) {
    hasErrors = true
    console.error(`\n❌ Extra keys in ${file} (not in ${baseLocale}):`)
    extraInFile.forEach((k) => console.error('  -', k))
  }

  for (const key of baseKeys) {
    const baseValue = getValue(baseData, key)
    const value = getValue(data, key)
    if (typeof value !== typeof baseValue) {
      hasErrors = true
      console.error(`\n❌ Type mismatch in ${file} at ${key}`)
    }
    if (typeof value === 'string' && !value.trim()) {
      hasErrors = true
      console.error(`\n❌ Empty translation in ${file} at ${key}`)
    }
    if (
      JSON.stringify(getPlaceholders(value)) !==
      JSON.stringify(getPlaceholders(baseValue))
    ) {
      hasErrors = true
      console.error(`\n❌ Placeholder mismatch in ${file} at ${key}`)
    }
  }
}

if (hasErrors) {
  console.error('\n❌ Locale validation failed.')
  process.exit(1)
}

console.log('\n✅ All locales are synchronized and valid!')
