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
  temperature?: number
  maxOutputTokens?: number
  /** Reads the bytes of a message image; the "Ask AI" images by default */
  loadImage?: (id: string) => Promise<Uint8Array<ArrayBuffer>>
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
      const loadImage = options.loadImage ?? deps.getImage
      if (typeof messages !== 'string') {
        for (const message of messages) {
          for (const image of message.images || []) {
            if (options.signal?.aborted) return ''
            if (!imageBytes.has(image.id))
              imageBytes.set(
                image.id,
                await loadImage(image.id).catch(() => {
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
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
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
