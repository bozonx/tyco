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
      getUsableModelIds: () => ['model'],
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
    f.model.addFallback('aiTask')
    f.model.addFallback('aiTask')
    expect(f.config.tasks.aiTask.modelChain).toEqual(['model'])
  })
})
