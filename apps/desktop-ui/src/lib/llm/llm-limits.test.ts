import { DEFAULT_LLM_CONFIG } from '@tyco/shared'
import { expect, it } from 'vitest'
import { taskModelLimits } from './llm-limits'

it('budgets against every model in the task chain', () => {
  const config = structuredClone(DEFAULT_LLM_CONFIG)
  config.taskModelChains.translation = ['gemini-flash', 'local-qwen']
  expect(taskModelLimits(config, 'translation')).toEqual({
    contextWindowTokens: 4096,
    maxOutputTokens: 1024,
  })
  config.models[0].maxOutputTokens = 256
  expect(taskModelLimits(config, 'translation').maxOutputTokens).toBe(256)
})
