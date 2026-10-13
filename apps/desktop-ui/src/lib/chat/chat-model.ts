import type { LlmConfig } from '@tyco/shared'
import { buildLlmPrompt, type LlmPromptOptions } from '../llm/llm-prompt'

import {
  modelContextWindowTokens,
  modelMaxOutputTokens,
  supportsImages,
  usableModels,
} from '../llm/llm-catalog'

export interface ChatModelOption {
  id: string
  name: string
  providerLabel: string
  canUseImages: boolean
  contextWindowTokens: number
  maxOutputTokens?: number
}

/**
 * Models the chat can actually call: complete, and with a key unless their
 * provider is a custom endpoint, which usually takes none
 */
export function chatModelOptions(
  config: LlmConfig,
  hasKey: (providerId: string) => boolean
): ChatModelOption[] {
  return usableModels(config)
    .filter(
      ({ provider }) =>
        provider.type === 'openai-compatible' || hasKey(provider.id)
    )
    .map(({ model, provider }) => ({
      id: model.id,
      name: model.name?.trim() || model.providerModelId.trim(),
      providerLabel: provider.name?.trim() || provider.type,
      canUseImages: supportsImages(model),
      contextWindowTokens: modelContextWindowTokens(model, config.providers),
      maxOutputTokens: modelMaxOutputTokens(model, config.providers),
    }))
}

/** The model last used in the chat, or the first one when it is gone */
export function pickChatModel(
  options: ChatModelOption[],
  lastModelId: string | null | undefined
): ChatModelOption | null {
  return (
    options.find((option) => option.id === lastModelId) ?? options[0] ?? null
  )
}

/**
 * Approximate input budget, reserving at least a quarter of the context for
 * output and subtracting the system prompt before admitting conversation text.
 */
export function contextBudgetCharacters(
  contextWindowTokens: number,
  maxOutputTokens = Math.floor(contextWindowTokens / 4),
  systemCharacters = 0
): number {
  const reservedTokens = Math.max(contextWindowTokens / 4, maxOutputTokens)
  return Math.max(
    0,
    Math.floor((contextWindowTokens - reservedTokens) * 3) - systemCharacters
  )
}

/** Subtracts the exact system text assembled for the chat request. */
export function chatRequestBudgetCharacters(
  model: ChatModelOption,
  promptOptions: Pick<LlmPromptOptions, 'instructions' | 'rules' | 'rulePrefix'>
): number {
  const system = buildLlmPrompt([], promptOptions).system || ''
  return contextBudgetCharacters(
    model.contextWindowTokens,
    model.maxOutputTokens,
    system.length
  )
}
