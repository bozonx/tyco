import { describe, expect, it, vi } from 'vitest'

import { normalizeLlmConfig } from './llm-config'
import { createLlmSettingsModel } from './llm-settings-model'

describe('LLM settings model', () => {
  function fixture(checkConnection = vi.fn().mockResolvedValue(undefined)) {
    const config = normalizeLlmConfig({
      providers: [
        {
          id: 'local',
          type: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
        },
      ],
      models: [{ id: 'model', model: 'test', provider: 'local' }],
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
    expect(f.setSecret).toHaveBeenCalledWith('local', 'key', [
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
    expect(f.model.connectionState.local).toBe('checking')
    f.model.removeProviderById('local')
    resolve()
    await pending
    expect(f.model.connectionState.local).toBeUndefined()
    expect(f.config.models).toEqual([])
    expect(f.providerRemoved).toHaveBeenCalledWith('local')
  })
  it('validates numeric settings and never adds duplicate fallback models', () => {
    const f = fixture()
    const model = f.config.models[0]
    f.model.setNumber(model, 'temperature', '3')
    expect(model.temperature).toBeUndefined()
    f.model.setNumber(model, 'temperature', '0.25')
    expect(model.temperature).toBe(0.25)
    f.model.setNumber(model, 'contextSize', '10.8')
    expect(model.contextSize).toBe(11)
    f.model.setNumber(model, 'contextSize', '')
    expect(model.contextSize).toBeUndefined()
    f.model.addFallback('aiTasks')
    f.model.addFallback('aiTasks')
    expect(f.config.tasks.aiTasks).toEqual(['model'])
  })
})
