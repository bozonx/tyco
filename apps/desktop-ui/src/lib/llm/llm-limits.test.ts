import { DEFAULT_LLM_CONFIG } from '@tyco/shared'
import { expect, it } from 'vitest'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from './llm-catalog'
import { taskModelLimits } from './llm-limits'

it('budgets against the task model', () => {
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  config.tasks.translation.modelId = 'ollama-qwen'
  expect(taskModelLimits(config, 'translation')).toEqual({
    contextWindowTokens: 4096,
    maxOutputTokens: 1024,
  })
  config.models[0].maxOutputTokens = 256
  expect(taskModelLimits(config, 'translation').maxOutputTokens).toBe(256)
})

it('falls back to a default budget without a model', () => {
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  config.tasks.translation.modelId = ''
  expect(taskModelLimits(config, 'translation')).toEqual({
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    maxOutputTokens: 1024,
  })
})
