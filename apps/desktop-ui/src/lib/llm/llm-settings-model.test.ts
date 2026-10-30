import { describe, expect, it, vi } from 'vitest'

import { normalizeLlmConfig } from './llm-config'
import { createLlmSettingsModel } from './llm-settings-model'

describe('LLM settings model', () => {
  function fixture(checkConnection = vi.fn().mockResolvedValue(undefined)) {
    const config = normalizeLlmConfig({
      providers: [
        {
          id: 'local',
          type: 'openaiCompatible',
          baseUrl: 'http://localhost:11434/v1',
        },
      ],
      models: [{ id: 'model', providerModelId: 'test', providerId: 'local' }],
    })
    const setSecret = vi.fn().mockResolvedValue(undefined)
    const notifyInvalidUrl = vi.fn()
    const providerRemoved = vi.fn()
    const model = createLlmSettingsModel({
      getConfig: () => config,
      setSecret,
      removeSecret: vi.fn().mockResolvedValue(undefined),
      checkConnection,
      notifyKeyError: vi.fn(),
      notifyInvalidUrl,
      formatConnectionError: (error) => String(error),
      providerRemoved,
    })
    return {
      model,
      config,
      setSecret,
      notifyInvalidUrl,
      providerRemoved,
      provider: config.providers.find((provider) => provider.id === 'local')!,
    }
  }
  it('binds keys to the provider origin and rejects invalid base URLs before saving', async () => {
    const f = fixture()
    f.model.keyDrafts.local = ' key '
    await f.model.saveKey(f.provider)
    expect(f.setSecret).toHaveBeenCalledWith('llm.local', 'key', [
      'http://localhost:11434',
    ])
    expect(f.model.keyDrafts.local).toBe('')
    f.provider.baseUrl = 'invalid'
    f.model.keyDrafts.local = 'another'
    await f.model.saveKey(f.provider)
    expect(f.notifyInvalidUrl).toHaveBeenCalledOnce()
    expect(f.setSecret).toHaveBeenCalledOnce()
  })
  it('keeps a newer key draft and does not restore drafts for removed providers', async () => {
    const f = fixture()
    let finish!: () => void
    f.setSecret.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    f.model.keyDrafts.local = 'old'
    const pending = f.model.saveKey(f.provider)
    f.model.keyDrafts.local = 'new'
    finish()
    await pending
    expect(f.model.keyDrafts.local).toBe('new')

    const another = f.model.saveKey(f.provider)
    f.model.removeProviderById('local')
    finish()
    await another
    expect(f.model.keyDrafts.local).toBeUndefined()
    expect(f.model.connectionCheckStatusByProviderId.local).toBeUndefined()
  })
  it('does not resurrect connection state after provider removal or disposal', async () => {
    let resolve!: () => void
    const f = fixture(
      vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done
          })
      )
    )
    const pending = f.model.checkConnection(f.provider)
    expect(f.model.connectionCheckStatusByProviderId.local).toBe('checking')
    f.model.removeProviderById('local')
    resolve()
    await pending
    expect(f.model.connectionCheckStatusByProviderId.local).toBeUndefined()
    expect(f.config.models).toEqual([])
    expect(f.providerRemoved).toHaveBeenCalledWith('local')
  })
  it('validates numeric settings and never adds duplicate fallback models', () => {
    const f = fixture()
    const model = f.config.models[0]
    model.temperature = 0.5
    f.model.setNumber(model, 'temperature', '3')
    expect(model.temperature).toBe(0.5)
    expect(f.model.numberErrors['model:temperature']).toBe(true)
    expect(f.model.numberDrafts['model:temperature']).toBe('3')
    f.model.setNumber(model, 'temperature', '0.25')
    expect(model.temperature).toBe(0.25)
    f.model.setNumber(model, 'contextWindowTokens', '10.8')
    expect(model.contextWindowTokens).toBeUndefined()
    expect(f.model.numberErrors['model:contextWindowTokens']).toBe(true)
    f.model.setNumber(model, 'contextWindowTokens', '11')
    expect(model.contextWindowTokens).toBe(11)
    f.model.setNumber(model, 'contextWindowTokens', '')
    expect(model.contextWindowTokens).toBeUndefined()
  })
  it('keeps a new model out of the config until its id has a character', () => {
    const f = fixture()
    f.model.addModelToProvider('local')
    expect(f.config.models).toHaveLength(1)
    const [draft, saved] = f.model.modelsOf('local')
    expect(saved.id).toBe('model')
    expect(f.model.isDraftModel(draft.id)).toBe(true)

    f.model.setNumber(draft, 'temperature', '0.4')
    f.model.updateModel(draft, { name: 'Draft', providerModelId: '  ' })
    expect(f.config.models).toHaveLength(1)

    f.model.updateModel(draft, { providerModelId: 'q' })
    expect(f.model.isDraftModel(draft.id)).toBe(false)
    expect(f.config.models[0]).toMatchObject({
      id: draft.id,
      name: 'Draft',
      providerModelId: 'q',
      temperature: 0.4,
    })
  })

  it('discards drafts on removal, with their provider and on disposal', () => {
    const f = fixture()
    f.model.addModelToProvider('local')
    f.model.addModelToProvider('local')
    const [first, second] = f.model.modelsOf('local')
    expect(first.id).not.toBe(second.id)
    f.model.discardDraftModel(first.id)
    expect(f.model.modelsOf('local')).toHaveLength(2)
    f.model.dispose()
    expect(f.model.modelsOf('local')).toHaveLength(1)

    f.model.addModelToProvider('local')
    f.model.removeProviderById('local')
    expect(f.model.modelsOf('local')).toHaveLength(0)
  })
})
