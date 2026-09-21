import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONTEXT_SIZE,
  OUTPUT_TOKENS_CEILING,
  buildLlmCatalog,
  buildProviderFactories,
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
    expect(gemini.model).toBe('gemini-2.5-flash')
    expect(gemini.contextSize).toBe(DEFAULT_CONTEXT_SIZE)
    expect(gemini.maxOutputTokens).toBe(OUTPUT_TOKENS_CEILING)

    const local = catalog.require('local-qwen')
    expect(local.provider).toBe('local')
    expect(local.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('turns task chains into task classes', () => {
    const catalog = buildLlmCatalog(
      config({
        tasks: {
          ...DEFAULT_LLM_CONFIG.tasks,
          chat: ['gemini-flash', 'deepseek-chat'],
        },
      })
    )!

    expect(names(catalog.candidatesFor('chat'))).toEqual([
      'gemini-flash',
      'deepseek-chat',
    ])
    expect(names(catalog.candidatesFor('translate'))).toEqual(['local-qwen'])
  })

  it('leaves out unfinished models and the tasks left without any', () => {
    const base = config()
    const catalog = buildLlmCatalog({
      ...base,
      providers: base.providers.map((provider) =>
        provider.id === 'local'
          ? { ...provider, baseUrl: 'not a url' }
          : provider
      ),
      models: [
        ...base.models,
        { id: 'blank', provider: 'google', model: '  ' },
      ],
      tasks: { ...base.tasks, chat: ['blank', 'gemini-flash'] },
    })!

    expect(catalog.find('local-qwen')).toBeUndefined()
    expect(catalog.find('blank')).toBeUndefined()
    expect(names(catalog.candidatesFor('chat'))).toEqual(['gemini-flash'])
    expect(catalog.taskClasses).not.toContain('translate')
  })

  it('caps a configured output limit at the ceiling', () => {
    const base = config()
    const catalog = buildLlmCatalog({
      ...base,
      models: [
        { id: 'a', provider: 'google', model: 'g', maxOutputTokens: 1024 },
        {
          id: 'b',
          provider: 'google',
          model: 'g',
          maxOutputTokens: 10_000_000,
        },
      ],
      tasks: { ...base.tasks, chat: ['a'] },
    })!

    expect(catalog.require('a').maxOutputTokens).toBe(1024)
    expect(catalog.require('b').maxOutputTokens).toBe(OUTPUT_TOKENS_CEILING)
  })

  it('has no catalog when no model is usable', () => {
    const base = config()

    expect(
      buildLlmCatalog({
        ...base,
        models: base.models.map((model) => ({ ...model, model: '' })),
      })
    ).toBeNull()
  })

  it('registers an adapter per custom endpoint only', () => {
    const factories = buildProviderFactories(config())

    expect(Object.keys(factories)).toEqual(['local'])
  })
})
