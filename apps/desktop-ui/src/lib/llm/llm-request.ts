import type { ChatMessage } from '@tyco/shared'

import {
  runChatToolLoop,
  type ChatToolApprovalRequest,
  type ChatToolLoopState,
} from '../chat-tools/chat-tool-loop'
import {
  createChatToolPolicy,
  type ChatToolDecision,
  type ChatToolPolicy,
} from '../chat-tools/chat-tool-policy'
import type { ChatToolSet } from '../chat-tools/chat-tool-registry'
import { LlmError, type LlmClient, type LlmRunName } from './llm-client'
import {
  handleLlmRequestError,
  type LlmRequestErrorDependencies,
} from './llm-request-error'
import { buildLlmPrompt, type LlmPrompt } from './llm-prompt'

export interface AiRequestOptions {
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
  onModel?: (model: { provider: string; model: string }) => void
  notifyError?: boolean
  /** The model to run on instead of the task's own */
  modelId?: string
  temperature?: number
  maxOutputTokens?: number
  /** Reads the bytes of a message image; the "Ask AI" images by default */
  loadImage?: (id: string) => Promise<Uint8Array<ArrayBuffer>>
}

/** The tools of a chat turn and how their calls are decided */
export interface AiChatTools {
  tools: ChatToolSet | null
  maxStepCount: number
  policy: ChatToolPolicy
  requestApproval: (
    request: ChatToolApprovalRequest,
    signal: AbortSignal
  ) => Promise<ChatToolDecision>
}

export interface AiChatTurnOptions extends Omit<AiRequestOptions, 'onChunk'> {
  instructions?: string
  rules?: string
  /** The answer so far, after every change */
  onUpdate: (state: ChatToolLoopState) => void
  /** Absent for a turn without tools */
  tools?: AiChatTools
  /** Whether the model calls tools, which decides how earlier steps are sent */
  canUseTools?: boolean
}

export interface LlmRequestDependencies extends LlmRequestErrorDependencies {
  client: LlmClient
  getImage: (id: string) => Promise<Uint8Array<ArrayBuffer>>
  rulePrefix: () => string
}

/** One plain turn: one call, no tools, nobody to ask */
const NO_TOOLS: AiChatTools = {
  tools: null,
  maxStepCount: 1,
  policy: createChatToolPolicy({ canAsk: false }),
  requestApproval: async () => 'deny',
}

export function createLlmRequest(deps: LlmRequestDependencies) {
  /** The prompt with the images loaded; null when aborted meanwhile */
  async function preparePrompt(
    messages: string | ChatMessage[],
    options: Pick<AiRequestOptions, 'signal' | 'loadImage'> & {
      instructions?: string
      rules?: string
      canUseTools?: boolean
    }
  ): Promise<LlmPrompt | null> {
    const imageBytes = new Map<string, Uint8Array<ArrayBuffer>>()
    const loadImage = options.loadImage ?? deps.getImage
    if (typeof messages !== 'string') {
      for (const message of messages) {
        for (const image of message.images || []) {
          if (options.signal?.aborted) return null
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
    if (options.signal?.aborted) return null
    return buildLlmPrompt(messages, {
      imageBytes,
      instructions: options.instructions,
      rules: options.rules,
      rulePrefix: deps.rulePrefix(),
      canUseTools: options.canUseTools,
    })
  }

  /** Runs a task on the configured model chain and preserves typed failures. */
  async function aiRequest(
    taskName: LlmRunName,
    messages: string | ChatMessage[],
    options: AiRequestOptions & { instructions?: string; rules?: string } = {}
  ) {
    try {
      const prompt = await preparePrompt(messages, options)
      if (!prompt) return ''

      return await deps.client.run(taskName, prompt, {
        modelId: options.modelId,
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

  /**
   * A chat turn, with tools when it has any: streamed, step by step. Resolves
   * with what came so far when aborted
   */
  async function aiChatTurn(
    messages: ChatMessage[],
    options: AiChatTurnOptions
  ): Promise<ChatToolLoopState> {
    const tools = options.tools ?? NO_TOOLS
    // what the tools need the model to know, e.g. the folders they reach
    const instructions = [options.instructions, tools.tools?.instructions]
      .map((text) => text?.trim())
      .filter(Boolean)
      .join('\n\n')
    try {
      const prompt = await preparePrompt(messages, {
        ...options,
        instructions: instructions || options.instructions,
      })
      if (!prompt) return { content: '', parts: [] }
      return await runChatToolLoop(
        {
          stream: (turnPrompt, streamOptions) =>
            deps.client.stream('chat', turnPrompt, streamOptions),
          requestApproval: tools.requestApproval,
          policy: tools.policy,
        },
        {
          prompt,
          tools: tools.tools,
          maxStepCount: tools.maxStepCount,
          signal: options.signal ?? new AbortController().signal,
          options: {
            modelId: options.modelId,
            temperature: options.temperature,
            maxOutputTokens: options.maxOutputTokens,
          },
          onUpdate: options.onUpdate,
          onModel: options.onModel,
        }
      )
    } catch (error) {
      handleLlmRequestError(error, 'LLM request "chat" failed', options, deps)
      return { content: '', parts: [] }
    }
  }

  return Object.assign(aiRequest, { chatTurn: aiChatTurn })
}
