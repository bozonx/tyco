import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatModelOptions,
  chatRequestBudgetCharacters,
  contextBudgetCharacters,
  pickChatModel,
} from './chat-llm-selection'

function config(): LlmConfig {
  return structuredClone(DEFAULT_LLM_CONFIG)
}

describe('chat-llm-selection', () => {
  it('offers only models with a key, and keyless local ones', () => {
    const options = chatModelOptions(config(), (id) => id === 'deepseek')

    expect(options.map((option) => option.id)).toEqual([
      'local-qwen',
      'deepseek-chat',
    ])
    expect(options[1]).toMatchObject({
      name: 'DeepSeek Flash',
      providerLabel: 'DeepSeek',
    })
  })

  it('leaves out unfinished models', () => {
    const llm = config()
    llm.models.push({ id: 'blank', providerId: 'google', providerModelId: ' ' })

    const options = chatModelOptions(llm, () => true)

    expect(options.map((option) => option.id)).not.toContain('blank')
  })

  it('picks the last used model while it is available', () => {
    const options = chatModelOptions(config(), () => true)

    expect(pickChatModel(options, 'deepseek-chat')?.id).toBe('deepseek-chat')
    expect(pickChatModel(options, 'gone')?.id).toBe('local-qwen')
    expect(pickChatModel([], 'gone')).toBeNull()
  })

  it('keeps a floor for the context budget', () => {
    expect(contextBudgetCharacters(128_000)).toBe(288_000)
    expect(contextBudgetCharacters(100)).toBe(225)
  })
})

describe('vision model options', () => {
  it('defaults only known shipped vision models and honors overrides', () => {
    const llm = config()
    let options = chatModelOptions(llm, () => true)
    expect(
      options.filter((model) => model.canUseImages).map((model) => model.id)
    ).toEqual(['gemini-flash', 'openrouter-gpt-4-1-mini'])
    llm.models[0].canUseImages = true
    llm.models[1].canUseImages = false
    options = chatModelOptions(llm, () => true)
    expect(
      options.find((model) => model.id === 'local-qwen')?.canUseImages
    ).toBe(true)
    expect(
      options.find((model) => model.id === 'gemini-flash')?.canUseImages
    ).toBe(false)
  })
})

it('reserves configured output and system text before admitting input', () => {
  expect(contextBudgetCharacters(4096, 3000, 600)).toBe(2688)
  expect(contextBudgetCharacters(4096, 4096, 600)).toBe(0)
  expect(contextBudgetCharacters(4096, 1024, 10000)).toBe(0)
})

it('exposes the same output reservation used by LLM requests', () => {
  const llm = config()
  llm.models[0].maxOutputTokens = 3000
  const options = chatModelOptions(llm, () => true)
  expect(options[0].maxOutputTokens).toBe(3000)
})

it('subtracts assembled instructions and rules from the chat input budget', () => {
  const model = {
    id: 'model',
    name: 'Model',
    providerLabel: 'Provider',
    canUseImages: false,
    canUseTools: false,
    contextWindowTokens: 4096,
    maxOutputTokens: 3000,
  }
  expect(
    chatRequestBudgetCharacters(model, {
      instructions: ' Instructions ',
      rules: ' Rules ',
      rulePrefix: 'Policy',
    })
  ).toBe(3288 - 'Instructions\n\nPolicy:\n\nRules'.length)
})
