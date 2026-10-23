import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  addCompatibleProvider,
  addModel,
  modelLabel,
  normalizeLlmConfig,
  removeModel,
  removeProvider,
  uniqueLlmId,
} from './llm-config'

const clone = (config: LlmConfig): LlmConfig => structuredClone(config)

describe('llm-config', () => {
  it('preserves the thinking mode', () => {
    const config = structuredClone(DEFAULT_LLM_CONFIG)
    config.models[0].isThinkingEnabled = true
    expect(normalizeLlmConfig(config).models[0].isThinkingEnabled).toBe(true)
  })

  it('keeps the default config as it is', () => {
    expect(normalizeLlmConfig(DEFAULT_LLM_CONFIG)).toEqual(DEFAULT_LLM_CONFIG)
  })

  it('takes the defaults for a missing section', () => {
    expect(normalizeLlmConfig(undefined)).toEqual(DEFAULT_LLM_CONFIG)
  })

  it('puts missing built-in providers back, first', () => {
    const config = normalizeLlmConfig({
      providers: [
        { id: 'local', type: 'openaiCompatible', baseUrl: 'http://x' },
        { id: 'deepseek', type: 'deepseek', name: 'Mine' },
      ],
    })

    expect(config.providers.map((provider) => provider.id)).toEqual([
      'google',
      'openrouter',
      'deepseek',
      'local',
    ])
    expect(config.providers[2].name).toBe('Mine')
  })

  it('drops providers that are malformed or impersonate a built-in', () => {
    const config = normalizeLlmConfig({
      providers: [
        { id: 'google', type: 'openaiCompatible', baseUrl: 'http://evil' },
        { id: 'Bad Id', type: 'openaiCompatible' },
        { id: 'x', type: 'unknown' },
        { id: 'custom', type: 'google' },
        { id: 'local', type: 'openaiCompatible' },
        { id: 'local', type: 'openaiCompatible', baseUrl: 'http://dup' },
      ],
    })

    expect(config.providers.find((p) => p.id === 'google')?.type).toBe('google')
    expect(
      config.providers.filter(
        (p) => !['google', 'openrouter', 'deepseek'].includes(p.id)
      )
    ).toEqual([{ id: 'local', type: 'openaiCompatible', baseUrl: '' }])
  })

  it('keeps models of known providers and cleans their numbers', () => {
    const config = normalizeLlmConfig({
      models: [
        {
          id: 'a',
          providerId: 'google',
          providerModelId: 'gemini',
          temperature: '0.5',
          maxOutputTokens: '1000.4',
          contextWindowTokens: -1,
        },
        { id: 'a', providerId: 'google', providerModelId: 'dup' },
        { id: ' d ', providerId: 'google', providerModelId: 'spaced' },
        { id: 'Upper', providerId: 'google', providerModelId: 'upper' },
        { id: 'b', providerId: 'nowhere', providerModelId: 'x' },
        { id: 'c', providerId: 'deepseek' },
      ],
    })

    expect(config.models).toEqual([
      {
        id: 'a',
        providerId: 'google',
        providerModelId: 'gemini',
        canUseImages: false,
        canUseTools: false,
      },
      {
        id: 'c',
        providerId: 'deepseek',
        providerModelId: '',
        canUseImages: false,
        canUseTools: false,
      },
    ])
  })

  it('keeps task chains to known models without silently assigning defaults', () => {
    const config = normalizeLlmConfig({
      models: [
        { id: 'a', providerId: 'google', providerModelId: 'g' },
        { id: 'b', providerId: 'deepseek', providerModelId: 'd' },
      ],
      tasks: {
        aiTask: { modelChain: ['b', 'gone', 'b', 'a'] },
        translation: { modelChain: [] },
      },
    })

    expect(config.tasks.aiTask.modelChain).toEqual(['b', 'a'])
    expect(config.tasks.translation.modelChain).toEqual([])
    expect(config.tasks.correction.modelChain).toEqual([])
  })

  it('generates unique ids', () => {
    expect(uniqueLlmId('local', [])).toBe('local')
    expect(uniqueLlmId('local', ['local', 'local-2'])).toBe('local-3')
  })

  it('does not reuse a removed provider id', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    const first = addCompatibleProvider(config)
    removeProvider(config, first.id)
    const second = addCompatibleProvider(config)
    expect(second.id).not.toBe(first.id)
  })

  it('adds and removes a custom provider with its models', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    const provider = addCompatibleProvider(config)
    const model = addModel(config, provider.id)
    config.tasks.aiTask.modelChain = [model.id, 'ollama-qwen']

    expect(provider.id).toMatch(/^custom-[a-f0-9-]{36}$/)
    expect(model.id).toBe(`${provider.id}-model`)

    removeProvider(config, provider.id)
    expect(config.providers.some((item) => item.id === provider.id)).toBe(false)
    expect(config.models.some((item) => item.id === model.id)).toBe(false)
    expect(config.tasks.aiTask.modelChain).toEqual(['ollama-qwen'])
  })

  it('never removes a built-in provider', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    removeProvider(config, 'google')

    expect(config.providers.some((item) => item.id === 'google')).toBe(true)
    expect(config.models.some((item) => item.id === 'gemini-flash')).toBe(true)
  })

  it('removes a model from every task', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    config.tasks.translation.modelChain = ['gemini-flash', 'ollama-qwen']
    removeModel(config, 'gemini-flash')

    expect(config.tasks.translation.modelChain).toEqual(['ollama-qwen'])
  })

  it('labels a model by name, then model id', () => {
    expect(modelLabel({ id: 'x', providerModelId: 'm', name: ' N ' })).toBe('N')
    expect(modelLabel({ id: 'x', providerModelId: 'm', name: '' })).toBe('m')
    expect(modelLabel({ id: 'x', providerModelId: '' })).toBe('x')
  })
})
