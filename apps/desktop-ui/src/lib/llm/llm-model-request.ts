import type { StreamRequest } from '@bozonx/ai-kit'
import type { LlmConfig, LlmModel } from '@tyco/shared'

import type { LlmRunName } from './llm-client'

/** The parts of a request that a call may set over the model's own */
export interface ModelRequestOverrides {
  temperature?: number
  maxOutputTokens?: number
}

/** The config with `task` bound to `model`: the catalog takes it from there */
export function bindTaskModel(
  config: LlmConfig,
  task: LlmRunName,
  model: LlmModel
): LlmConfig {
  return {
    ...config,
    tasks: {
      ...config.tasks,
      [task]: { ...config.tasks[task], modelId: model.id },
    },
  } as LlmConfig
}

/** Sampling, output limit and provider options of a request to `model` */
export function modelRequestOptions(
  config: LlmConfig,
  model: LlmModel,
  overrides: ModelRequestOverrides
): Pick<StreamRequest, 'providerOptions' | 'temperature' | 'maxOutputTokens'> {
  const isDeepSeek =
    config.providers.find((provider) => provider.id === model.providerId)
      ?.type === 'deepseek'
  const temperature = overrides.temperature ?? model.temperature
  // Without a limit of its own a model answers as long as it needs; a
  // default here would cut long answers and the reasoning of thinking models
  const outputTokenCaps = [
    overrides.maxOutputTokens,
    model.maxOutputTokens,
  ].filter((value): value is number => value !== undefined)
  const isThinkingEnabled =
    model.isThinkingEnabled === true ||
    model.providerModelId === 'deepseek-reasoner'
  return {
    ...(isDeepSeek
      ? {
          providerOptions: {
            deepseek: {
              thinking: { type: isThinkingEnabled ? 'enabled' : 'disabled' },
            },
          },
        }
      : {}),
    ...(temperature === undefined || (isDeepSeek && isThinkingEnabled)
      ? {}
      : { temperature }),
    ...(outputTokenCaps.length
      ? { maxOutputTokens: Math.min(...outputTokenCaps) }
      : {}),
  }
}
