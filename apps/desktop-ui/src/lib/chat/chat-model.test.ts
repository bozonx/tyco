import { DEFAULT_LLM_CONFIG, type LlmConfig } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import {
  chatModelOptions,
  contextBudgetCharacters,
  pickChatModel,
} from './chat-model'

function config(): LlmConfig {
  return structuredClone(DEFAULT_LLM_CONFIG)
}

describe('chat-model', () => {
  it('offers only models with a key, and keyless local ones', () => {
    const options = chatModelOptions(config(), (id) => id === 'deepseek')

    expect(options.map((option) => option.id)).toEqual([
      'local-qwen',
      'deepseek-chat',
    ])
    expect(options[1]).toMatchObject({
      name: 'DeepSeek Chat',
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
    expect(contextBudgetCharacters(100)).toBe(4_000)
  })
})

describe('vision model options', () => {
  it('defaults only known shipped vision models and honors overrides', () => {
    const llm = config()
    let options = chatModelOptions(llm, () => true)
    expect(
      options.filter((model) => model.vision).map((model) => model.id)
    ).toEqual(['gemini-flash', 'openrouter-gpt-4-1-mini'])
    llm.models[0].vision = true
    llm.models[1].vision = false
    options = chatModelOptions(llm, () => true)
    expect(options.find((model) => model.id === 'local-qwen')?.vision).toBe(
      true
    )
    expect(options.find((model) => model.id === 'gemini-flash')?.vision).toBe(
      false
    )
  })
})
