import type { LlmConfig, LlmTask } from '@tyco/shared'
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  modelContextWindowTokens,
  modelMaxOutputTokens,
} from './llm-catalog'
import { taskModel } from './llm-config'

/** The output reserved when a task has no model at all */
const NO_MODEL_MAX_OUTPUT_TOKENS = 1024

/** The budget of the model a task answers with */
export function taskModelLimits(config: LlmConfig, task: LlmTask) {
  const model = taskModel(config, task)
  if (!model)
    return {
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
      maxOutputTokens: NO_MODEL_MAX_OUTPUT_TOKENS,
    }
  return {
    contextWindowTokens: modelContextWindowTokens(model, config.providers),
    maxOutputTokens: modelMaxOutputTokens(model, config.providers),
  }
}
