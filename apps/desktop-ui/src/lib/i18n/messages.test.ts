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
  'voiceGrammar.translate',
  'voiceGrammar.actions.askInChat',
  ...[
    'en-US',
    'en-GB',
    'es-AR',
    'es-ES',
    'ru-RU',
    'tr-TR',
    'de-DE',
    'fr-FR',
    'it-IT',
    'pt-BR',
    'pt-PT',
    'uk-UA',
    'zh-CN',
    'ja-JP',
  ].map((id) => `voiceGrammar.languages.${id}`),
  ...[
    'auto',
    'ru-RU',
    'en-US',
    'en-GB',
    'es',
    'es-ES',
    'es-AR',
    'pt-BR',
    'pt-PT',
    'de-DE',
    'fr-FR',
    'it-IT',
    'nl-NL',
    'pl-PL',
    'uk-UA',
    'tr-TR',
    'cs-CZ',
    'hu-HU',
    'ro-RO',
    'el-GR',
    'hr-HR',
    'ka-GE',
    'kk-KZ',
    'ar-SA',
    'hi-IN',
    'bn-BD',
    'ur-PK',
    'fa-IR',
    'he-IL',
    'zh-CN',
    'zh-TW',
    'ja-JP',
    'ko-KR',
    'vi-VN',
    'th-TH',
    'id-ID',
    'ms-MY',
  ].map((code) => `language.${code}`),
  ...['correction', 'command'].map((action) => `selection.working.${action}`),
  ...['correction', 'command'].map((action) => `selection.failed.${action}`),
  ...['correction', 'command'].map((action) => `selection.unchanged.${action}`),
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
    'quickInput',
    'voice',
    'editor',
    'chat',
    'voiceChat',
    'voiceCommands',
    'selectionActions',
    'aiTasks',
    'selectionCorrection',
    'correction',
    'translation',
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
  /\b(?:labelKey|titleKey|messageKey|reasonKey|phrasesKey|nameKey|hintKey|descriptionKey|helpKey|escapeButtonLabelKey)\s*:\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
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
    const sourceFiles = [
      ...walkDir(srcDir),
      ...walkDir(path.resolve(srcDir, '../../../packages/plugin-sdk/src')),
    ]
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
    const sourceFiles = [
      ...walkDir(srcDir),
      ...walkDir(path.resolve(srcDir, '../../../packages/plugin-sdk/src')),
    ]
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
      { locale: 'en-US', key: 'common.confirm', expected: 'Confirm' },
      { locale: 'ru-RU', key: 'common.confirm', expected: 'Подтвердить' },
      { locale: 'es', key: 'common.confirm', expected: 'Confirmar' },
      { locale: 'de-DE', key: 'common.confirm', expected: 'Bestätigen' },
      { locale: 'ja-JP', key: 'common.confirm', expected: '確認' },
      { locale: 'tr-TR', key: 'common.confirm', expected: 'Onayla' },
    ]

    for (const { locale, key, expected } of testCases) {
      setI18nLocale(locale)
      expect(translate(key)).toBe(expected)
    }

    // Reset back to default
    setI18nLocale(DEFAULT_UI_LOCALE)
  })
})
