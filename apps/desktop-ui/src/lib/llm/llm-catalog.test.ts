import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  OUTPUT_TOKENS_CEILING,
  buildLlmCatalog,
  buildProviderFactories,
  canUseTools,
} from './llm-catalog'

const names = (models: readonly { name: string }[]) =>
  models.map((model) => model.name)

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return { ...structuredClone(DEFAULT_LLM_CONFIG), ...overrides }
}

describe('llm-catalog', () => {
  it('maps every model to a catalog entry', () => {
    const catalog = buildLlmCatalog(config())!

    const gemini = catalog.require('gemini-flash')
    expect(gemini.provider).toBe('google')
    expect(gemini.model).toBe('gemini-3.8-flash')
    expect(gemini.contextSize).toBe(128_000)
    expect(gemini.maxOutputTokens).toBe(OUTPUT_TOKENS_CEILING)

    const local = catalog.require('ollama-qwen')
    expect(local.contextSize).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(local.provider).toBe('ollama')
    expect(local.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('lets cloud models call tools and a custom endpoint only when told', () => {
    const base = config()
    const catalog = buildLlmCatalog(base)!
    expect(catalog.require('gemini-flash').capabilities.tools).toBe(true)
    expect(catalog.require('ollama-qwen').capabilities.tools).toBe(false)

    const local = base.models.find((model) => model.id === 'ollama-qwen')!
    expect(canUseTools({ ...local, canUseTools: true }, base.providers)).toBe(
      true
    )
    const gemini = base.models.find((model) => model.id === 'gemini-flash')!
    expect(canUseTools({ ...gemini, canUseTools: false }, base.providers)).toBe(
      false
    )
    expect(
      canUseTools({ ...gemini, providerId: 'missing' }, base.providers)
    ).toBe(false)
  })

  it('turns task chains into task classes', () => {
    const catalog = buildLlmCatalog(
      config({
        tasks: {
          ...DEFAULT_LLM_CONFIG.tasks,
          aiTask: { modelChain: ['gemini-flash', 'deepseek-chat'] },
        },
      })
    )!

    expect(names(catalog.candidatesFor('aiTask'))).toEqual([
      'gemini-flash',
      'deepseek-chat',
    ])
    expect(names(catalog.candidatesFor('translation'))).toEqual(['ollama-qwen'])
  })

  it('leaves out unfinished models and the tasks left without any', () => {
    const base = config()
    const catalog = buildLlmCatalog({
      ...base,
      providers: base.providers.map((provider) =>
        provider.id === 'ollama'
          ? { ...provider, baseUrl: 'not a url' }
          : provider
      ),
      models: [
        ...base.models,
        { id: 'blank', providerId: 'google', providerModelId: '  ' },
      ],
      tasks: {
        ...base.tasks,
        aiTask: { modelChain: ['blank', 'gemini-flash'] },
      },
    })!

    expect(catalog.find('ollama-qwen')).toBeUndefined()
    expect(catalog.find('blank')).toBeUndefined()
    expect(names(catalog.candidatesFor('aiTask'))).toEqual(['gemini-flash'])
    expect(catalog.taskClasses).not.toContain('translation')
  })

  it('caps a configured output limit at the ceiling', () => {
    const base = config()
    const catalog = buildLlmCatalog({
      ...base,
      models: [
        {
          id: 'a',
          providerId: 'google',
          providerModelId: 'g',
          maxOutputTokens: 1024,
        },
        {
          id: 'b',
          providerId: 'google',
          providerModelId: 'g',
          maxOutputTokens: 10_000_000,
        },
      ],
      tasks: { ...base.tasks, aiTask: { modelChain: ['a'] } },
    })!

    expect(catalog.require('a').maxOutputTokens).toBe(1024)
    expect(catalog.require('b').maxOutputTokens).toBe(OUTPUT_TOKENS_CEILING)
  })

  it('has no catalog when no model is usable', () => {
    const base = config()

    expect(
      buildLlmCatalog({
        ...base,
        models: base.models.map((model) => ({ ...model, providerModelId: '' })),
      })
    ).toBeNull()
  })

  it('registers an adapter per custom endpoint only', () => {
    const factories = buildProviderFactories(config())

    expect(Object.keys(factories)).toEqual(['ollama'])
  })
})
