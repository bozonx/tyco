import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

import { i18n, setI18nLocale, translate } from './index'
import { DEFAULT_UI_LOCALE, type UiLocale, messages } from './messages'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const srcDir = path.resolve(__dirname, '../..')

function collectKeys(source: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(source)
    .flatMap(([key, value]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return collectKeys(value as Record<string, unknown>, nextKey)
      }

      return [nextKey]
    })
    .sort()
}

function getValue(source: Record<string, unknown>, key: string): unknown {
  let value: unknown = source
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

function getPlaceholders(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort()
}

function walkDir(dir: string): string[] {
  const files: string[] = []
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

/** Known dynamically generated key families */
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
  ...['disabled', 'activating', 'active', 'error', 'incompatible'].map(
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

describe('i18n messages', () => {
  const baseKeys = collectKeys(messages[DEFAULT_UI_LOCALE])
  const baseKeySet = new Set(baseKeys)

  it('keeps the same translation keys across all locales', () => {
    for (const [localeName, localeMessages] of Object.entries(messages)) {
      expect(
        collectKeys(localeMessages as Record<string, unknown>),
        `Locale ${localeName} keys mismatch`
      ).toEqual(baseKeys)
    }
  })

  it('prohibits and disables fallbackLocale in createI18n instance', () => {
    // vue-i18n fallbackLocale must be false so no silent fallbacks happen
    expect(i18n.global.fallbackLocale.value).toBe(false)
  })

  it('has identical placeholders across all locales for each key', () => {
    const baseSource = messages[DEFAULT_UI_LOCALE] as Record<string, unknown>

    for (const [localeName, localeMessages] of Object.entries(messages)) {
      if (localeName === DEFAULT_UI_LOCALE) continue
      const targetSource = localeMessages as Record<string, unknown>

      for (const key of baseKeys) {
        const basePlaceholders = getPlaceholders(getValue(baseSource, key))
        const targetPlaceholders = getPlaceholders(getValue(targetSource, key))
        expect(
          targetPlaceholders,
          `Placeholder mismatch in ${localeName} at key "${key}"`
        ).toEqual(basePlaceholders)
      }
    }
  })

  it('ensures all translations are non-empty strings without malformed placeholders', () => {
    for (const [localeName, localeMessages] of Object.entries(messages)) {
      const source = localeMessages as Record<string, unknown>
      for (const key of baseKeys) {
        const val = getValue(source, key)
        expect(typeof val, `Type of "${key}" in ${localeName}`).toBe('string')
        const str = (val as string).trim()
        expect(
          str.length,
          `Empty string at "${key}" in ${localeName}`
        ).toBeGreaterThan(0)

        // Check for unbalanced braces like '{param' without closing '}'
        const openBraces = (str.match(/\{/g) || []).length
        const closeBraces = (str.match(/\}/g) || []).length
        expect(
          openBraces,
          `Unbalanced braces in "${key}" in ${localeName}: "${str}"`
        ).toBe(closeBraces)
      }
    }
  })

  it('ensures all translation keys referenced in application code exist across all locales', () => {
    const sourceFiles = walkDir(srcDir)
    const missingKeys: { file: string; key: string }[] = []

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8')
      for (const pattern of KEY_PATTERNS) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
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
          if (!baseKeySet.has(key)) {
            missingKeys.push({ file: path.relative(srcDir, file), key })
          }
        }
      }
    }

    expect(
      missingKeys,
      `Found missing keys in application code:\n${JSON.stringify(missingKeys, null, 2)}`
    ).toEqual([])

    // Also ensure all dynamic keys are present in locale dictionary
    for (const dynamicKey of DYNAMIC_KEYS) {
      expect(
        baseKeySet.has(dynamicKey),
        `Dynamic key missing: ${dynamicKey}`
      ).toBe(true)
    }
  })

  it('ensures no unused / dead keys exist in locale files', () => {
    const sourceFiles = walkDir(srcDir)
    const allContent = sourceFiles
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n')

    const unusedKeys: string[] = []
    for (const key of baseKeys) {
      if (DYNAMIC_KEYS.has(key)) continue
      if (!allContent.includes(key)) {
        unusedKeys.push(key)
      }
    }

    expect(
      unusedKeys,
      `Found unused/dead keys in locale files:\n${unusedKeys.join('\n')}`
    ).toEqual([])
  })

  it('translates keys across all supported locales without fallback', () => {
    const testCases: { locale: UiLocale; key: string; expected: string }[] = [
      { locale: 'en_US', key: 'common.confirm', expected: 'Confirm' },
      { locale: 'ru_RU', key: 'common.confirm', expected: 'Подтвердить' },
      { locale: 'es_AR', key: 'common.confirm', expected: 'Confirmar' },
      { locale: 'tr_TR', key: 'common.confirm', expected: 'Onayla' },
    ]

    for (const { locale, key, expected } of testCases) {
      setI18nLocale(locale)
      expect(translate(key)).toBe(expected)
    }

    // Reset back to default
    setI18nLocale(DEFAULT_UI_LOCALE)
  })
})
