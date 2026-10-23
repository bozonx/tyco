import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { normalizeTranslationConfig } from './translation-config'
import {
  createTranslationSettingsModel,
  formatTranslationGlossary,
  parseTranslationGlossary,
} from './translation-settings-model'

function setup() {
  const state = reactive({
    config: normalizeTranslationConfig({ provider: 'deepl' }),
  })
  const deps = {
    getConfig: () => state.config,
    setConfig: (config: typeof state.config) => {
      state.config = config
    },
    hasSecret: vi.fn(() => true),
    setSecret: vi.fn(async (_id: string, _value: string) => {}),
    removeSecret: vi.fn(async (_id: string) => {}),
    notifyKeyError: vi.fn(),
  }
  return { state, deps, model: createTranslationSettingsModel(deps) }
}

describe('translation glossary', () => {
  it('preserves protected terms and equals signs in replacements while ignoring incomplete lines', () => {
    const entries = parseTranslationGlossary(
      ' !TyCo \n cat = gato \n equation = a=b\ninvalid\n = missing\nmissing =\n!\n'
    )
    expect(entries).toEqual([
      { term: 'TyCo', translation: 'TyCo' },
      { term: 'cat', translation: 'gato' },
      { term: 'equation', translation: 'a=b' },
    ])
    expect(
      parseTranslationGlossary(formatTranslationGlossary(entries))
    ).toEqual(entries)
  })
})

describe('translation settings model', () => {
  it('normalizes edits and derives secret status, rules and glossary', () => {
    const { model, deps } = setup()
    model.keyDraft.value = 'draft'
    model.updateProvider('google')
    expect(model.keyDraft.value).toBe('')
    expect(model.providerSecretId.value).toBe('translation.google')
    expect(model.hasProviderKey.value).toBe(true)
    expect(deps.hasSecret).toHaveBeenCalledWith('translation.google')
    model.updateQualityGate('off')
    expect(model.usesTranslationRules.value).toBe(false)
    model.updateGlossary('!TyCo')
    expect(model.glossaryText.value).toBe('!TyCo')
    model.updateProvider('llm')
    expect(model.usesTranslationRules.value).toBe(true)
  })

  it('selects the DeepL endpoint after a successful save and clears the draft', async () => {
    const { model, state, deps } = setup()
    model.keyDraft.value = ' free-key:fx '
    await model.saveProviderKey()
    expect(deps.setSecret).toHaveBeenCalledWith(
      'translation.deepl',
      'free-key:fx'
    )
    expect(state.config.providers.deepl.endpoint).toBe('free')
    expect(model.keyDraft.value).toBe('')
    model.keyDraft.value = 'pro-key'
    await model.saveProviderKey()
    expect(state.config.providers.deepl.endpoint).toBe('pro')
    await model.removeProviderKey()
    expect(deps.removeSecret).toHaveBeenCalledWith('translation.deepl')
  })

  it('retains failed drafts and reports save and removal failures', async () => {
    const { model, deps } = setup()
    const error = new Error('Secret storage unavailable')
    deps.setSecret.mockRejectedValue(error)
    deps.removeSecret.mockRejectedValue(error)
    model.keyDraft.value = 'draft'
    await model.saveProviderKey()
    expect(model.keyDraft.value).toBe('draft')
    await model.removeProviderKey()
    expect(deps.notifyKeyError).toHaveBeenCalledTimes(2)
    expect(deps.notifyKeyError).toHaveBeenCalledWith(error)
  })

  it('ignores empty drafts and does not operate on secrets for an LLM provider', async () => {
    const { model, deps } = setup()
    model.keyDraft.value = ' '
    await model.saveProviderKey()
    model.updateProvider('llm')
    model.keyDraft.value = 'unused'
    await model.saveProviderKey()
    await model.removeProviderKey()
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.removeSecret).not.toHaveBeenCalled()
  })

  it('does not apply a pending save to a different provider or clear a newer draft', async () => {
    const { model, state, deps } = setup()
    let finish!: () => void
    deps.setSecret.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    model.keyDraft.value = 'old:fx'
    const pending = model.saveProviderKey()
    model.updateProvider('google')
    model.keyDraft.value = 'new-google-key'
    finish()
    await pending
    expect(state.config.provider).toBe('google')
    expect(model.keyDraft.value).toBe('new-google-key')

    model.updateProvider('deepl')
    model.keyDraft.value = 'old:fx'
    const another = model.saveProviderKey()
    model.keyDraft.value = 'new-deepl-key'
    finish()
    await another
    expect(model.keyDraft.value).toBe('new-deepl-key')
  })
})
