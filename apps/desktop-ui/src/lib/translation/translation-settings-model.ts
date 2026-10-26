import { computed, ref, watch } from 'vue'

import {
  TRANSLATION_SECRET_IDS,
  isGlossaryTermKept,
  normalizeGlossaryEntry,
  normalizeGlossaryLanguage,
  type TranslationConfig,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

import { createSecretKeyEditor } from '../settings/secret-key-editor'
import { normalizeTranslationConfig } from './translation-config'

/** A `code: text` part of a glossary line, e.g. `pt-BR: espaço` */
const LANGUAGE_PART =
  /^([a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*|[A-Z]{2}(?:[-_][A-Za-z0-9]{2,8})*)\s*:\s*(.+)$/

/**
 * Reads glossary lines: `!term` keeps a term, `term = text` translates it into
 * every language, and `; code: text` parts translate it into particular ones:
 * `workspace = espacio de trabajo; ru: рабочее пространство`
 */
export function parseTranslationGlossary(
  value: string
): TranslationGlossaryEntry[] {
  const entries: TranslationGlossaryEntry[] = []
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('!')) {
      const term = trimmed.slice(1).trim()
      if (term) entries.push({ term, translation: term })
      continue
    }
    const [termPart, ...translationParts] = trimmed.split('=')
    const defaultParts: string[] = []
    const translations: Record<string, string> = {}
    let currentLanguage: string | undefined
    for (const part of translationParts.join('=').split(';')) {
      const match = LANGUAGE_PART.exec(part.trim())
      const language = match && normalizeGlossaryLanguage(match[1]!)
      if (language) {
        currentLanguage = language
        translations[language] = match[2]!.trim()
      } else if (currentLanguage) {
        translations[currentLanguage] =
          `${translations[currentLanguage]}; ${part.trim()}`
      } else {
        defaultParts.push(part.trim())
      }
    }
    const entry = normalizeGlossaryEntry({
      term: termPart ?? '',
      translation: defaultParts.join('; '),
      translations,
    })
    if (entry) entries.push(entry)
  }
  return entries
}

export function formatTranslationGlossary(
  entries: TranslationGlossaryEntry[]
): string {
  return entries
    .map((entry) =>
      isGlossaryTermKept(entry)
        ? `!${entry.term}`
        : `${entry.term} = ${[
            entry.translation,
            ...Object.entries(entry.translations ?? {}).map(
              ([language, text]) => `${language}: ${text}`
            ),
          ]
            .filter(Boolean)
            .join('; ')}`
    )
    .join('\n')
}

export function createTranslationSettingsModel(deps: {
  getConfig: () => TranslationConfig
  setConfig: (config: TranslationConfig) => void
  hasSecret: (id: string) => boolean
  setSecret: (id: string, value: string) => Promise<void>
  removeSecret: (id: string) => Promise<void>
  notifyKeyError: (error: unknown) => void
}) {
  const translation = computed(deps.getConfig)
  const keyDraft = ref('')
  const providerSecretId = computed(() =>
    translation.value.provider === 'google'
      ? TRANSLATION_SECRET_IDS.google
      : TRANSLATION_SECRET_IDS.deepl
  )
  const hasProviderKey = computed(() => deps.hasSecret(providerSecretId.value))
  // The text being typed: unfinished lines stay in it, and it is reformatted
  // only on commit or when the glossary changes elsewhere
  const glossaryText = ref(
    formatTranslationGlossary(translation.value.glossary)
  )
  watch(
    () => translation.value.glossary,
    (glossary) => {
      if (
        JSON.stringify(glossary) !==
        JSON.stringify(parseTranslationGlossary(glossaryText.value))
      )
        glossaryText.value = formatTranslationGlossary(glossary)
    }
  )
  const usesTranslationRules = computed(
    () => translation.value.provider === 'llm'
  )
  function updateProvider(value: string | number | undefined) {
    deps.setConfig(
      normalizeTranslationConfig({ ...translation.value, provider: value })
    )
    keyDraft.value = ''
  }
  function updateQualityGate(value: string | number | undefined) {
    deps.setConfig(
      normalizeTranslationConfig({ ...translation.value, qualityGate: value })
    )
  }
  function updateGlossary(value: string) {
    glossaryText.value = value
    deps.setConfig({
      ...translation.value,
      glossary: parseTranslationGlossary(value),
    })
  }
  /** Shows the saved glossary and retains unfinished lines without rules */
  function commitGlossary() {
    const formatted = formatTranslationGlossary(translation.value.glossary)
    const incompleteLines = glossaryText.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('!') && !line.includes('='))
    glossaryText.value = incompleteLines.length
      ? [formatted, ...incompleteLines].filter(Boolean).join('\n')
      : formatted
  }
  const keyEditor = createSecretKeyEditor({
    getSecretId: () =>
      translation.value.provider === 'llm' ? undefined : providerSecretId.value,
    getDraft: () => keyDraft.value,
    setDraft: (value) => {
      keyDraft.value = value
    },
    setSecret: deps.setSecret,
    removeSecret: deps.removeSecret,
    reportError: deps.notifyKeyError,
    onSaved: (value) => {
      if (translation.value.provider === 'deepl')
        deps.setConfig(
          normalizeTranslationConfig({
            ...translation.value,
            providers: {
              ...translation.value.providers,
              deepl: { endpoint: value.endsWith(':fx') ? 'free' : 'pro' },
            },
          })
        )
    },
  })
  const saveProviderKey = () => keyEditor.save()
  const removeProviderKey = keyEditor.remove

  return {
    translation,
    keyDraft,
    providerSecretId,
    hasProviderKey,
    glossaryText,
    usesTranslationRules,
    updateProvider,
    updateQualityGate,
    updateGlossary,
    commitGlossary,
    saveProviderKey,
    removeProviderKey,
  }
}
