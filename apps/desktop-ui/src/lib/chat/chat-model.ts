import type { LlmConfig } from '@tyco/shared'

import { DEFAULT_CONTEXT_SIZE, usableModels } from '../llm/llm-catalog'

export interface ChatModelOption {
  id: string
  name: string
  provider: string
  contextSize: number
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
      name: model.name?.trim() || model.model.trim(),
      provider: provider.name?.trim() || provider.type,
      contextSize: model.contextSize ?? DEFAULT_CONTEXT_SIZE,
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
 * How much text, in characters, a request may carry: about 25% of the context
 * is left for instructions and output, and 3 characters per token is
 * deliberately conservative for multilingual text
 */
export function contextBudgetCharacters(contextSize: number): number {
  return Math.max(4_000, Math.floor(contextSize * 3 * 0.75))
}
