import { computed, ref } from 'vue'

import {
  TRANSLATION_SECRET_IDS,
  isGlossaryTermKept,
  type TranslationConfig,
  type TranslationGlossaryEntry,
} from '@tyco/shared'

import { createSecretKeyEditor } from '../settings/secret-key-editor'
import { normalizeTranslationConfig } from './translation-config'

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
    const term = termPart?.trim()
    const translation = translationParts.join('=').trim()
    if (term && translation) entries.push({ term, translation })
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
        : `${entry.term} = ${entry.translation}`
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
  const glossaryText = computed(() =>
    formatTranslationGlossary(translation.value.glossary)
  )
  const usesTranslationRules = computed(
    () =>
      translation.value.provider === 'llm' ||
      translation.value.qualityGate !== 'off'
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
    deps.setConfig({
      ...translation.value,
      glossary: parseTranslationGlossary(value),
    })
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
    saveProviderKey,
    removeProviderKey,
  }
}
