import { computed, ref } from 'vue'

import type { TranslationConfig, TranslationGlossaryEntry } from '@tyco/shared'

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
      if (term) entries.push({ term, use: term, doNotTranslate: true })
      continue
    }
    const [termPart, ...useParts] = trimmed.split('=')
    const term = termPart?.trim()
    const use = useParts.join('=').trim()
    if (term && use) entries.push({ term, use, doNotTranslate: false })
  }
  return entries
}

export function formatTranslationGlossary(
  entries: TranslationGlossaryEntry[]
): string {
  return entries
    .map((entry) =>
      entry.doNotTranslate ? `!${entry.term}` : `${entry.term} = ${entry.use}`
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
    translation.value.provider === 'google' ? 'google-translate' : 'deepl'
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
  function updateCorrectionPrompt(value: string) {
    deps.setConfig({ ...translation.value, qualityGatePrompt: value })
  }
  function updateGlossary(value: string) {
    deps.setConfig({
      ...translation.value,
      glossary: parseTranslationGlossary(value),
    })
  }
  async function saveProviderKey() {
    const value = keyDraft.value.trim()
    if (!value || translation.value.provider === 'llm') return
    const providerId = translation.value.provider
    const secretId = providerSecretId.value
    const draft = keyDraft.value
    try {
      await deps.setSecret(secretId, value)
      if (translation.value.provider !== providerId) return
      if (secretId === 'deepl')
        deps.setConfig(
          normalizeTranslationConfig({
            ...translation.value,
            deeplEndpoint: value.endsWith(':fx') ? 'free' : 'pro',
          })
        )
      if (keyDraft.value === draft) keyDraft.value = ''
    } catch (error) {
      deps.notifyKeyError(error)
    }
  }
  async function removeProviderKey() {
    if (translation.value.provider === 'llm') return
    try {
      await deps.removeSecret(providerSecretId.value)
    } catch (error) {
      deps.notifyKeyError(error)
    }
  }
  return {
    translation,
    keyDraft,
    providerSecretId,
    hasProviderKey,
    glossaryText,
    usesTranslationRules,
    updateProvider,
    updateQualityGate,
    updateCorrectionPrompt,
    updateGlossary,
    saveProviderKey,
    removeProviderKey,
  }
}
