import type { ChatMessage } from '@tyco/shared'
import { LlmError, type LlmClient, type LlmRunName } from './llm-client'
import {
  handleLlmRequestError,
  type LlmRequestErrorDependencies,
} from './llm-request-error'
import { buildLlmPrompt } from './llm-prompt'

export interface AiRequestOptions {
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
  onModel?: (model: { provider: string; model: string }) => void
  notifyError?: boolean
  /** Models to run on instead of the task's chain */
  models?: string[]
}

export interface LlmRequestDependencies extends LlmRequestErrorDependencies {
  client: LlmClient
  getImage: (id: string) => Promise<Uint8Array<ArrayBuffer>>
  rulePrefix: () => string
}

export function createLlmRequest(deps: LlmRequestDependencies) {
  /** Runs a task on the configured model chain and preserves typed failures. */
  async function aiRequest(
    taskName: LlmRunName,
    messages: string | ChatMessage[],
    options: AiRequestOptions & { instructions?: string; rules?: string } = {}
  ) {
    try {
      const imageBytes = new Map<string, Uint8Array<ArrayBuffer>>()
      if (typeof messages !== 'string') {
        for (const message of messages) {
          for (const image of message.images || []) {
            if (options.signal?.aborted) return ''
            if (!imageBytes.has(image.id))
              imageBytes.set(
                image.id,
                await deps.getImage(image.id).catch(() => {
                  throw new LlmError(
                    'unknown',
                    deps.translate('chat.imageUnavailable')
                  )
                })
              )
          }
        }
      }
      if (options.signal?.aborted) return ''
      const prompt = buildLlmPrompt(messages, {
        imageBytes,
        instructions: options.instructions,
        rules: options.rules,
        rulePrefix: deps.rulePrefix(),
      })

      return await deps.client.run(taskName, prompt, {
        models: options.models,
        onChunk: options.onChunk,
        signal: options.signal,
        onModel: options.onModel,
      })
    } catch (error) {
      return handleLlmRequestError(
        error,
        `LLM request "${taskName}" failed`,
        options,
        deps
      )
    }
  }

  return aiRequest
}
