import {
  AiError,
  AllCandidatesFailedError,
  CatalogError,
  NoSuitableModelError,
  createAiKit,
  type AiErrorKind,
  type AiKit,
  type KeyProvider,
  type StreamRequest,
  type Transport,
} from '@bozonx/ai-kit'
import type { LlmConfig, LlmTask } from '@tyco/shared'

import {
  buildLlmCatalog,
  buildProviderFactories,
  modelMaxOutputTokens,
} from './llm-catalog'
import type { LlmPrompt } from './llm-prompt'

/**
 * A whole answer may take a while on a slow local model; ai-kit's own default
 * budget is meant for a server
 */
const CALL_TIMEOUT_MS = 300_000

export type LlmErrorKind =
  | Exclude<AiErrorKind, 'no_candidates'>
  | 'no_model'
  | 'config'
  | 'unknown'
  | 'image_unsupported'
  | 'output_truncated'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  partialText?: string

  constructor(kind: LlmErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export interface LlmClientDependencies {
  getConfig: () => LlmConfig
  transport: Transport
  keys: KeyProvider
  timeoutMs?: number
}

/**
 * Custom endpoints are usually local servers that take no key; the built-in
 * cloud providers always need one
 */
export function isKeylessProvider(config: LlmConfig, providerId: string) {
  return config.providers.some(
    (provider) =>
      provider.id === providerId && provider.type === 'openai-compatible'
  )
}

/** A configured task, or the chat, which runs on the model picked in it */
export type LlmRunName = LlmTask | 'chat'

interface LlmRunOptions {
  /**
   * Model ids to try in order instead of the task's chain; the chat passes the
   * one model picked in it
   */
  models?: string[]
  /** Streams the answer; each piece of text as it arrives */
  onChunk?: (text: string) => void
  signal?: AbortSignal
  onModel?: (model: { provider: string; model: string }) => void
}

export interface LlmClient {
  /**
   * Runs a task on its model chain, or on `options.models`. Resolves with the
   * text produced so far when aborted
   *
   * @throws LlmError
   */
  run: (
    task: LlmRunName,
    prompt: LlmPrompt,
    options?: LlmRunOptions
  ) => Promise<string>
}

export function createLlmClient(deps: LlmClientDependencies): LlmClient {
  const kits = new Map<string, AiKit>()

  /** Rebuilt when the config changes, reused otherwise */
  const kitFor = (config: LlmConfig, timeoutMs = CALL_TIMEOUT_MS): AiKit => {
    const key = `${timeoutMs}:${JSON.stringify(config)}`

    const cached = kits.get(key)
    if (cached) return cached
    const catalog = buildLlmCatalog(config)
    if (!catalog) {
      throw new LlmError('no_model', 'No language model is configured')
    }
    const kit = createAiKit({
      catalog,
      keys: deps.keys,
      transport: deps.transport,
      providers: buildProviderFactories(config),
      retry: { totalTimeoutMs: timeoutMs },
    })
    if (kits.size >= 20) kits.clear()
    kits.set(key, kit)
    return kit
  }

  return {
    async run(task, prompt, options = {}) {
      if (options.signal?.aborted) return ''
      const config = deps.getConfig()
      const chain =
        options.models ?? (task === 'chat' ? [] : config.tasks[task]) ?? []
      const candidates = chain
        .map((id) => config.models.find((model) => model.id === id))
        .filter((model) => model !== undefined)
      if (candidates.length === 0) {
        throw new LlmError(
          'no_model',
          `No language model is configured for ${task}`
        )
      }

      const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS
      const deadline = Date.now() + timeoutMs
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal
      let firstError: LlmError | undefined
      for (const model of candidates) {
        if (options.signal?.aborted) return ''
        if (signal.aborted || Date.now() >= deadline)
          throw new LlmError('timeout', 'The language model request timed out')
        let emittedText = false
        let streamedText = ''
        // the catalog's task classes come from `tasks`; the chat is one too
        const scopedConfig = {
          ...config,
          tasks: { ...config.tasks, [task]: [model.id] },
        } as LlmConfig
        try {
          const kit = kitFor(scopedConfig)
          const isDeepSeek =
            config.providers.find(
              (provider) => provider.id === model.providerId
            )?.type === 'deepseek'
          const isThinkingEnabled =
            model.isThinkingEnabled === true ||
            model.providerModelId === 'deepseek-reasoner'
          const request: StreamRequest = {
            name: task,
            policy: { taskClass: task },
            ...prompt,
            ...(isDeepSeek
              ? {
                  providerOptions: {
                    deepseek: {
                      thinking: {
                        type: isThinkingEnabled ? 'enabled' : 'disabled',
                      },
                    },
                  },
                }
              : {}),
            ...(model.temperature === undefined ||
            (isDeepSeek && isThinkingEnabled)
              ? {}
              : { temperature: model.temperature }),
            maxOutputTokens: modelMaxOutputTokens(model, config.providers),
            abortSignal: signal,
            totalTimeoutMs: Math.max(1, deadline - Date.now()),
          }

          if (!options.onChunk) {
            const result = await kit.generate(request)
            options.onModel?.({
              provider: result.provider,
              model: result.model,
            })
            ensureCompleteAnswer(result.finishReason, result.text)
            return result.text
          }

          let completed = false
          for await (const part of kit.stream(request)) {
            if (part.type === 'model') {
              options.onModel?.({ provider: part.provider, model: part.model })
            } else if (part.type === 'text-delta') {
              emittedText = true
              streamedText += part.text
              options.onChunk(part.text)
            } else if (part.type === 'error') {
              if (options.signal?.aborted) return streamedText
              throw new LlmError(errorKind(part.kind), part.message)
            } else if (part.type === 'finish') {
              ensureCompleteAnswer(part.finishReason, streamedText)
              completed = true
            }
          }
          if (!completed) ensureCompleteAnswer('unknown', streamedText)
          return streamedText
        } catch (error) {
          if (options.signal?.aborted) return streamedText
          if (signal.aborted) {
            const timeout = new LlmError(
              'timeout',
              'The language model request timed out'
            )
            timeout.partialText = streamedText
            throw timeout
          }
          const llmError = toLlmError(error)
          if (emittedText || llmError.partialText) throw llmError
          const hasImages = prompt.messages.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some(
                (part) =>
                  part.type === 'file' && part.mediaType.startsWith('image/')
              )
          )
          firstError ??=
            hasImages &&
            (llmError.kind === 'invalid_request' ||
              (llmError.kind === 'unknown' &&
                /(?:unsupported|not support).*(?:image|vision)|(?:image|vision).*(?:unsupported|not support)/i.test(
                  llmError.message
                )))
              ? new LlmError('image_unsupported', llmError.message, {
                  cause: llmError,
                })
              : llmError
        }
      }
      throw firstError ?? new LlmError('unknown', 'All language models failed')
    },
  }
}

function ensureCompleteAnswer(finishReason: string, text: string) {
  if (finishReason === 'stop' && text.trim()) return
  const kind =
    finishReason === 'length'
      ? 'output_truncated'
      : finishReason === 'content-filter'
        ? 'content_filter'
        : 'invalid_output'
  const error = new LlmError(
    kind,
    finishReason === 'length'
      ? 'The answer reached its output token limit'
      : `The model returned an incomplete answer (${finishReason})`
  )
  error.partialText = text
  throw error
}

export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error
  if (error instanceof NoSuitableModelError) {
    return new LlmError('no_model', error.message, { cause: error })
  }
  if (error instanceof CatalogError) {
    return new LlmError('config', error.message, { cause: error })
  }
  if (error instanceof AllCandidatesFailedError) {
    // The primary's failure is the one the user can act on
    const first = error.failures[0]?.error
    return new LlmError(
      first ? errorKind(first.kind) : 'unknown',
      first?.message ?? error.message,
      { cause: error }
    )
  }
  if (error instanceof AiError) {
    return new LlmError(errorKind(error.kind), error.message, { cause: error })
  }
  return new LlmError(
    'unknown',
    error instanceof Error ? error.message : String(error),
    { cause: error }
  )
}

function errorKind(kind: AiErrorKind): LlmErrorKind {
  return kind === 'no_candidates' ? 'no_model' : kind
}
