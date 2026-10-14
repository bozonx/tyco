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

  it('builds a usable config from nothing', () => {
    const config = normalizeLlmConfig(undefined)

    expect(config.providers.map((provider) => provider.id)).toEqual([
      'google',
      'openrouter',
      'deepseek',
    ])
    expect(config.models).toEqual([])
    expect(config.tasks.aiTasks).toEqual([])
  })

  it('puts missing built-in providers back, first', () => {
    const config = normalizeLlmConfig({
      providers: [
        { id: 'local', type: 'openai-compatible', baseUrl: 'http://x' },
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
        { id: 'google', type: 'openai-compatible', baseUrl: 'http://evil' },
        { id: 'Bad Id', type: 'openai-compatible' },
        { id: 'x', type: 'unknown' },
        { id: 'custom', type: 'google' },
        { id: 'local', type: 'openai-compatible' },
        { id: 'local', type: 'openai-compatible', baseUrl: 'http://dup' },
      ],
    })

    expect(config.providers.find((p) => p.id === 'google')?.type).toBe('google')
    expect(
      config.providers.filter(
        (p) => !['google', 'openrouter', 'deepseek'].includes(p.id)
      )
    ).toEqual([{ id: 'local', type: 'openai-compatible', baseUrl: '' }])
  })

  it('keeps models of known providers and cleans their numbers', () => {
    const config = normalizeLlmConfig({
      models: [
        {
          id: ' a ',
          providerId: 'google',
          providerModelId: 'gemini',
          temperature: '0.5',
          maxOutputTokens: '1000.4',
          contextWindowTokens: -1,
        },
        { id: 'a', providerId: 'google', providerModelId: 'dup' },
        { id: 'b', providerId: 'nowhere', providerModelId: 'x' },
        { id: 'c', providerId: 'deepseek' },
      ],
    })

    expect(config.models).toEqual([
      { id: 'a', providerId: 'google', providerModelId: 'gemini' },
      { id: 'c', providerId: 'deepseek', providerModelId: '' },
    ])
  })

  it('keeps task chains to known models without silently assigning defaults', () => {
    const config = normalizeLlmConfig({
      models: [
        { id: 'a', providerId: 'google', providerModelId: 'g' },
        { id: 'b', providerId: 'deepseek', providerModelId: 'd' },
      ],
      tasks: { aiTasks: ['b', 'gone', 'b', 'a'], translate: [] },
    })

    expect(config.tasks.aiTasks).toEqual(['b', 'a'])
    expect(config.tasks.translate).toEqual([])
    expect(config.tasks.correction).toEqual([])
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
    config.tasks.aiTasks = [model.id, 'local-qwen']

    expect(provider.id).toMatch(/^local-[a-f0-9-]{36}$/)
    expect(model.id).toBe(`${provider.id}-model`)

    removeProvider(config, provider.id)
    expect(config.providers.some((item) => item.id === provider.id)).toBe(false)
    expect(config.models.some((item) => item.id === model.id)).toBe(false)
    expect(config.tasks.aiTasks).toEqual(['local-qwen'])
  })

  it('never removes a built-in provider', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    removeProvider(config, 'google')

    expect(config.providers.some((item) => item.id === 'google')).toBe(true)
    expect(config.models.some((item) => item.id === 'gemini-flash')).toBe(true)
  })

  it('removes a model from every task', () => {
    const config = clone(DEFAULT_LLM_CONFIG)
    config.tasks.translate = ['gemini-flash', 'local-qwen']
    removeModel(config, 'gemini-flash')

    expect(config.tasks.translate).toEqual(['local-qwen'])
  })

  it('labels a model by name, then model id', () => {
    expect(
      modelLabel({
        id: 'x',
        providerId: 'p',
        providerModelId: 'm',
        name: ' N ',
      })
    ).toBe('N')
    expect(
      modelLabel({ id: 'x', providerId: 'p', providerModelId: 'm', name: '' })
    ).toBe('m')
    expect(modelLabel({ id: 'x', providerId: 'p', providerModelId: '' })).toBe(
      'x'
    )
  })
})
