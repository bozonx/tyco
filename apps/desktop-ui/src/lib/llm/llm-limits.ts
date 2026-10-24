import type { LlmConfig, LlmTask } from '@tyco/shared'
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  modelContextWindowTokens,
  modelMaxOutputTokens,
} from './llm-catalog'

/** The output reserved when a task has no model at all */
const NO_MODEL_MAX_OUTPUT_TOKENS = 1024

/**
 * Budget against the smallest fallback, so a long input can use the whole
 * chain.
 */
export function taskModelLimits(config: LlmConfig, task: LlmTask) {
  const models = config.tasks[task].modelChain
    .map((id) => config.models.find((model) => model.id === id))
    .filter((model) => model !== undefined)
  if (!models.length)
    return {
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
      maxOutputTokens: NO_MODEL_MAX_OUTPUT_TOKENS,
    }
  return {
    contextWindowTokens: Math.min(
      ...models.map((model) =>
        modelContextWindowTokens(model, config.providers)
      )
    ),
    maxOutputTokens: Math.min(
      ...models.map((model) => modelMaxOutputTokens(model, config.providers))
    ),
  }
}
