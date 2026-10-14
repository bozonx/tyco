import type { LlmConfig, LlmTask } from '@tyco/shared'
import { modelContextWindowTokens } from './llm-catalog'

/**
 * Budget against the smallest fallback, so a long input can use the whole
 * chain.
 */
export function taskModelLimits(config: LlmConfig, task: LlmTask) {
  const models = config.taskModelChains[task]
    .map((id) => config.models.find((model) => model.id === id))
    .filter((model) => model !== undefined)
  if (!models.length)
    return { contextWindowTokens: 4096, maxOutputTokens: 1024 }
  return {
    contextWindowTokens: Math.min(
      ...models.map((model) =>
        modelContextWindowTokens(model, config.providers)
      )
    ),
    maxOutputTokens: Math.min(
      ...models.map(
        (model) =>
          model.maxOutputTokens ??
          Math.min(
            4096,
            Math.floor(modelContextWindowTokens(model, config.providers) / 4)
          )
      )
    ),
  }
}
