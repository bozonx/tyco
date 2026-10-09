#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const root = path.resolve(__dirname, '..')
const desktopUiDir = path.join(root, 'apps/desktop-ui')
const desktopUiSrcDir = path.join(desktopUiDir, 'src')
const desktopUiLocalesDir = path.join(desktopUiSrcDir, 'lib/i18n/locales')
const packagesDir = path.join(root, 'packages')

const REQUIRED_UI_LOCALES = [
  'en_US.json',
  'es_AR.json',
  'ru_RU.json',
  'tr_TR.json',
]

const localeDirectories = [
  desktopUiLocalesDir,
  ...fs
    .readdirSync(packagesDir)
    .filter((name) => name.startsWith('plugin-'))
    .map((name) => path.join(packagesDir, name, 'src/locales'))
    .filter((dir) => fs.existsSync(dir)),
]

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

/**
 * Recursively walks a directory for source code files.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
  /** @type {string[]} */
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['locales', 'node_modules', 'dist', '.git'].includes(entry.name)) {
        files.push(...walkDir(full))
      }
    } else if (
      /\.(vue|ts|js)$/.test(entry.name) &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(full)
    }
  }
  return files
}

/** Known dynamically generated key families for desktop-ui */
const DYNAMIC_KEYS = new Set([
  ...[
    'auto',
    'ru_RU',
    'en_US',
    'en_GB',
    'es_ES',
    'es_AR',
    'pt_BR',
    'pt_PT',
    'de_DE',
    'fr_FR',
    'it_IT',
    'nl_NL',
    'pl_PL',
    'uk_UA',
    'tr_TR',
    'ar_SA',
    'hi_IN',
    'bn_BD',
    'ur_PK',
    'fa_IR',
    'he_IL',
    'zh_CN',
    'zh_TW',
    'ja_JP',
    'ko_KR',
    'vi_VN',
    'th_TH',
    'id_ID',
    'ms_MY',
  ].map((code) => `language.${code}`),
  ...['correction', 'translate', 'aiTask', 'command'].map(
    (action) => `selection.working.${action}`
  ),
  ...['correction', 'translate', 'aiTask', 'command'].map(
    (action) => `selection.failed.${action}`
  ),
  ...['correction', 'translate', 'aiTask', 'command'].map(
    (action) => `selection.unchanged.${action}`
  ),
  ...['today', 'yesterday', 'previousWeek', 'older'].map(
    (group) => `chat.group.${group}`
  ),
  ...[
    'empty_output',
    'foreign_script',
    'untranslated',
    'length_gap',
    'structure',
    'placeholders',
    'looping',
    'truncation',
    'glossary',
  ].map((code) => `translationProblems.${code}`),
  ...[
    'write',
    'voice',
    'editor',
    'chat',
    'voiceChat',
    'select',
    'aiTasks',
    'commandLauncher',
    'inlineCorrection',
    'correction',
    'translate',
  ].map((mode) => `settings.hotkeyActions.${mode}`),
  ...['editor', 'browser', 'notes', 'none'].map(
    (cap) => `settings.pluginCapability.${cap}`
  ),
  ...['activating', 'error', 'incompatible'].map(
    (status) => `settings.pluginStatus.${status}`
  ),
  ...[
    'title',
    'bold',
    'italic',
    'strikethrough',
    'code',
    'link',
    'heading1',
    'heading2',
    'heading3',
    'bulletList',
    'orderedList',
    'quote',
    'showSource',
  ].map((cmd) => `editor.markup.${cmd}`),
])

const KEY_PATTERNS = [
  /\b(?:t|\$t|translate)\s*\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
  /\b(?:labelKey|titleKey|messageKey|reasonKey|phrasesKey|nameKey|hintKey|descriptionKey|helpKey|escBtnLabelKey)\s*:\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
]

let hasErrors = false

// 1. Check fallbackLocale policy in createI18n instance
const i18nIndexPath = path.join(desktopUiSrcDir, 'lib/i18n/index.ts')
if (fs.existsSync(i18nIndexPath)) {
  const i18nIndexContent = fs.readFileSync(i18nIndexPath, 'utf8')
  if (!i18nIndexContent.includes('fallbackLocale: false')) {
    hasErrors = true
    console.error(
      '❌ Fallback policy violation: apps/desktop-ui/src/lib/i18n/index.ts must set "fallbackLocale: false". No fallbacks allowed.'
    )
  }
}

// 2. Validate locale directories and files
for (const localesDir of localeDirectories) {
  const relDir = path.relative(root, localesDir)
  const localeFiles = fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.json'))
  const baseLocale = 'en_US.json'
  if (!localeFiles.includes(baseLocale)) {
    console.error(`❌ Base locale ${baseLocale} not found in ${relDir}.`)
    process.exit(1)
  }

  if (localesDir === desktopUiLocalesDir) {
    for (const reqLocale of REQUIRED_UI_LOCALES) {
      if (!localeFiles.includes(reqLocale)) {
        hasErrors = true
        console.error(
          `❌ Required UI locale ${reqLocale} not found in ${relDir}.`
        )
      }
    }
  }

  const baseData = JSON.parse(
    fs.readFileSync(path.join(localesDir, baseLocale), 'utf8')
  )
  const baseKeys = getAllKeys(baseData).sort()

  console.log(
    `[${relDir}] Base locale (${baseLocale}) total keys:`,
    baseKeys.length
  )

  for (const file of localeFiles) {
    if (file === baseLocale) continue

    const data = JSON.parse(
      fs.readFileSync(path.join(localesDir, file), 'utf8')
    )
    const keys = getAllKeys(data).sort()
    const missingInFile = baseKeys.filter((k) => !keys.includes(k))
    const extraInFile = keys.filter((k) => !baseKeys.includes(k))

    console.log(`[${relDir}] Checking ${file}: ${keys.length} keys`)

    if (missingInFile.length > 0) {
      hasErrors = true
      console.error(`\n❌ Missing in ${relDir}/${file}:`)
      missingInFile.forEach((k) => console.error('  -', k))
    }

    if (extraInFile.length > 0) {
      hasErrors = true
      console.error(
        `\n❌ Extra keys in ${relDir}/${file} (not in ${baseLocale}):`
      )
      extraInFile.forEach((k) => console.error('  -', k))
    }

    for (const key of baseKeys) {
      const baseValue = getValue(baseData, key)
      const value = getValue(data, key)
      if (typeof value !== typeof baseValue) {
        hasErrors = true
        console.error(`\n❌ Type mismatch in ${relDir}/${file} at ${key}`)
      }
      if (typeof value === 'string' && !value.trim()) {
        hasErrors = true
        console.error(`\n❌ Empty translation in ${relDir}/${file} at ${key}`)
      }
      if (typeof value === 'string') {
        const openBraces = (value.match(/\{/g) || []).length
        const closeBraces = (value.match(/\}/g) || []).length
        if (openBraces !== closeBraces) {
          hasErrors = true
          console.error(
            `\n❌ Unbalanced braces in ${relDir}/${file} at ${key}: "${value}"`
          )
        }
      }
      if (
        JSON.stringify(getPlaceholders(value)) !==
        JSON.stringify(getPlaceholders(baseValue))
      ) {
        hasErrors = true
        console.error(
          `\n❌ Placeholder mismatch in ${relDir}/${file} at ${key}`
        )
      }
    }
  }
}

// 3. Scan desktop-ui code for missing and unused keys
const desktopUiBaseData = JSON.parse(
  fs.readFileSync(path.join(desktopUiLocalesDir, 'en_US.json'), 'utf8')
)
const desktopUiBaseKeys = getAllKeys(desktopUiBaseData).sort()
const desktopUiKeySet = new Set(desktopUiBaseKeys)

const desktopUiSources = walkDir(desktopUiSrcDir)
const desktopUiSourceContent = desktopUiSources
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')

const missingInDesktopUi = []
for (const file of desktopUiSources) {
  const content = fs.readFileSync(file, 'utf8')
  for (const pattern of KEY_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(content)) !== null) {
      const key = match[1]
      if (
        !key ||
        key.startsWith('local.') ||
        key.startsWith('plugin.') ||
        key.startsWith('app://')
      ) {
        continue
      }
      if (!desktopUiKeySet.has(key)) {
        missingInDesktopUi.push({ file: path.relative(root, file), key })
      }
    }
  }
}

for (const dynamicKey of DYNAMIC_KEYS) {
  if (!desktopUiKeySet.has(dynamicKey)) {
    missingInDesktopUi.push({ file: 'dynamic', key: dynamicKey })
  }
}

if (missingInDesktopUi.length > 0) {
  hasErrors = true
  console.error('\n❌ Keys referenced in code but missing from locales:')
  missingInDesktopUi.forEach(({ file, key }) =>
    console.error(`  - ${key} (in ${file})`)
  )
}

const unusedInDesktopUi = []
for (const key of desktopUiBaseKeys) {
  if (DYNAMIC_KEYS.has(key)) continue
  if (!desktopUiSourceContent.includes(key)) {
    unusedInDesktopUi.push(key)
  }
}

if (unusedInDesktopUi.length > 0) {
  hasErrors = true
  console.error('\n❌ Unused / dead keys in apps/desktop-ui locales:')
  unusedInDesktopUi.forEach((k) => console.error('  -', k))
}

// 4. Scan plugin sources for unused/missing keys
const pluginDirs = fs
  .readdirSync(packagesDir)
  .filter((name) => name.startsWith('plugin-'))
  .map((name) => path.join(packagesDir, name))

for (const pluginDir of pluginDirs) {
  const pluginLocalesDir = path.join(pluginDir, 'src/locales')
  if (!fs.existsSync(pluginLocalesDir)) continue

  const pluginEnPath = path.join(pluginLocalesDir, 'en_US.json')
  const pluginData = JSON.parse(fs.readFileSync(pluginEnPath, 'utf8'))
  const pluginKeys = Object.keys(pluginData)
  const pluginKeySet = new Set(pluginKeys)

  const pluginSources = walkDir(path.join(pluginDir, 'src'))
  const pluginContent = pluginSources
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')

  const unusedPluginKeys = pluginKeys.filter(
    (k) => !pluginContent.includes(k) && !pluginContent.includes('local.' + k)
  )
  if (unusedPluginKeys.length > 0) {
    hasErrors = true
    console.error(
      `\n❌ Unused keys in ${path.relative(root, pluginLocalesDir)}:`
    )
    unusedPluginKeys.forEach((k) => console.error('  -', k))
  }

  for (const file of pluginSources) {
    const content = fs.readFileSync(file, 'utf8')
    const matches = content.matchAll(/local\.([a-zA-Z0-9_-]+)/g)
    for (const m of matches) {
      if (!pluginKeySet.has(m[1])) {
        hasErrors = true
        console.error(
          `\n❌ Missing key "${m[1]}" in ${path.relative(root, file)}`
        )
      }
    }
  }
}

if (hasErrors) {
  console.error('\n❌ Locale validation failed.')
  process.exit(1)
}

console.log(
  '\n✅ All locales are synchronized, complete, and valid (no unused keys, no missing keys, no fallbacks)!'
)
