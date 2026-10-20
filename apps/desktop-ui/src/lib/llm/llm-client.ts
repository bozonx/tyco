import { errorMessage } from '@tyco/shared/value-guards'
import {
  AiError,
  AllCandidatesFailedError,
  CatalogError,
  NoSuitableModelError,
  createAiKit,
  type AiErrorKind,
  type AiKit,
  type KeyProvider,
  type ModelMessage,
  type PrepareStep,
  type StreamRequest,
  type ToolApproval,
  type ToolSet,
  type Transport,
} from '@bozonx/ai-kit'
import type { LlmConfig, LlmModel, LlmTask } from '@tyco/shared'

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
  /** The tool loop used up its steps while the model still called tools */
  | 'step_limit'

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
      provider.id === providerId && provider.type === 'openaiCompatible'
  )
}

/** A configured task, or the chat, which runs on the model picked in it */
export type LlmRunName = LlmTask | 'chat'

interface LlmCallOptions {
  /**
   * Model ids to try in order instead of the task's chain; the chat passes the
   * one model picked in it
   */
  models?: string[]
  signal?: AbortSignal
  /** Replaces the temperature of every model tried */
  temperature?: number
  /** Caps the answer below each model's own output limit */
  maxOutputTokens?: number
}

interface LlmRunOptions extends LlmCallOptions {
  /** Streams the answer; each piece of text as it arrives */
  onChunk?: (text: string) => void
  onModel?: (model: { provider: string; model: string }) => void
}

/** Tools for one call. Without them `stream` is a plain streamed answer */
export interface LlmStreamOptions extends LlmCallOptions {
  tools?: ToolSet
  /** Which calls wait for a decision; `user-approval` ends the call there */
  toolApproval?: ToolApproval
  /** Model steps the call may take; each tool round trip is one */
  maxSteps?: number
  activeTools?: string[]
  prepareStep?: PrepareStep
}

/** What a streamed call produces, in the app's own terms */
export type LlmStreamEvent =
  | { type: 'model'; provider: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      output: unknown
      isError: boolean
    }
  | { type: 'tool-denied'; toolCallId: string; toolName: string }
  /** A call waits for the user; the stream finishes right after */
  | {
      type: 'approval-request'
      approvalId: string
      toolCallId: string
      toolName: string
      input: unknown
    }
  | { type: 'step-finish'; step: number; finishReason: string }
  | { type: 'file'; mediaType: string; data: string }
  | {
      type: 'sources'
      sources: Array<{ url: string; title?: string; snippet?: string }>
    }
  /**
   * The call is over. `tool-calls` means it stopped at approval requests and
   * continues with `responseMessages` once they are answered
   */
  | {
      type: 'finish'
      finishReason: 'stop' | 'tool-calls'
      text: string
      responseMessages: ModelMessage[]
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
  /**
   * The same call as events, with tools. Ends without `finish` when aborted. A
   * model is replaced by the next one only before it has shown anything
   *
   * @throws LlmError
   */
  stream: (
    task: LlmRunName,
    prompt: LlmPrompt,
    options?: LlmStreamOptions
  ) => AsyncGenerator<LlmStreamEvent, void, undefined>
}

const hasImages = (prompt: LlmPrompt) =>
  prompt.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === 'file' && part.mediaType.startsWith('image/')
      )
  )

/**
 * The failure to report when no model answers: the first one's, which is the
 * one the user picked, named as an image refusal when that is what it was
 */
function candidateFailure(error: LlmError, prompt: LlmPrompt): LlmError {
  if (
    hasImages(prompt) &&
    (error.kind === 'invalid_request' ||
      (error.kind === 'unknown' &&
        /(?:unsupported|not support).*(?:image|vision)|(?:image|vision).*(?:unsupported|not support)/i.test(
          error.message
        )))
  ) {
    return new LlmError('image_unsupported', error.message, { cause: error })
  }
  return error
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

  /** The models a call tries, in order, and the time it has for all of them */
  const startCall = (task: LlmRunName, options: LlmCallOptions) => {
    const config = deps.getConfig()
    const chain =
      options.models ??
      (task === 'chat' ? [] : config.taskModelChains[task]) ??
      []
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
    const checkTime = () => {
      if (signal.aborted || Date.now() >= deadline)
        throw new LlmError('timeout', 'The language model request timed out')
    }
    return { config, candidates, deadline, signal, checkTime }
  }

  /** The request for one model, with the kit that sends it */
  const requestFor = (
    config: LlmConfig,
    task: LlmRunName,
    model: LlmModel,
    prompt: LlmPrompt,
    options: LlmCallOptions,
    signal: AbortSignal,
    deadline: number
  ) => {
    // the catalog's task classes come from `taskModelChains`; the chat is one too
    const scopedConfig = {
      ...config,
      taskModelChains: { ...config.taskModelChains, [task]: [model.id] },
    } as LlmConfig
    const kit = kitFor(scopedConfig)
    const isDeepSeek =
      config.providers.find((provider) => provider.id === model.providerId)
        ?.type === 'deepseek'
    const temperature = options.temperature ?? model.temperature
    const modelOutputTokens = modelMaxOutputTokens(model, config.providers)
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
                thinking: { type: isThinkingEnabled ? 'enabled' : 'disabled' },
              },
            },
          }
        : {}),
      ...(temperature === undefined || (isDeepSeek && isThinkingEnabled)
        ? {}
        : { temperature }),
      maxOutputTokens:
        options.maxOutputTokens === undefined
          ? modelOutputTokens
          : Math.min(options.maxOutputTokens, modelOutputTokens),
      abortSignal: signal,
      totalTimeoutMs: Math.max(1, deadline - Date.now()),
    }
    return { kit, request }
  }

  async function* stream(
    task: LlmRunName,
    prompt: LlmPrompt,
    options: LlmStreamOptions = {}
  ): AsyncGenerator<LlmStreamEvent, void, undefined> {
    if (options.signal?.aborted) return
    const { config, candidates, deadline, signal, checkTime } = startCall(
      task,
      options
    )
    const hasTools = Boolean(options.tools && Object.keys(options.tools).length)
    let firstError: LlmError | undefined
    for (const model of candidates) {
      if (options.signal?.aborted) return
      checkTime()
      // anything but the model's name reached the reader: no other model may
      // answer in its place
      let hasEmitted = false
      let text = ''
      let pendingApprovalCount = 0
      try {
        const { kit, request } = requestFor(
          config,
          task,
          model,
          prompt,
          options,
          signal,
          deadline
        )
        if (hasTools) {
          request.tools = options.tools
          if (options.toolApproval) request.toolApproval = options.toolApproval
          if (options.maxSteps !== undefined)
            request.maxSteps = options.maxSteps
          if (options.activeTools) request.activeTools = options.activeTools
          if (options.prepareStep) request.prepareStep = options.prepareStep
        }

        let isCompleted = false
        for await (const part of kit.stream(request)) {
          switch (part.type) {
            case 'model':
              yield {
                type: 'model',
                provider: part.provider,
                model: part.model,
              }
              break
            case 'text-delta':
              hasEmitted = true
              text += part.text
              yield { type: 'text', text: part.text }
              break
            case 'reasoning-delta':
              hasEmitted = true
              yield { type: 'reasoning', text: part.text }
              break
            case 'tool-call':
              hasEmitted = true
              yield {
                type: 'tool-call',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.args,
              }
              break
            case 'tool-result':
              hasEmitted = true
              yield {
                type: 'tool-result',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.result,
                isError: part.isError === true,
              }
              break
            case 'tool-denied':
              hasEmitted = true
              yield {
                type: 'tool-denied',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              }
              break
            case 'tool-approval-request':
              hasEmitted = true
              // a decision the approval rule made itself is not asked about
              if (part.isAutomatic) break
              pendingApprovalCount += 1
              yield {
                type: 'approval-request',
                approvalId: part.approvalId,
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.args,
              }
              break
            case 'step-finish':
              yield {
                type: 'step-finish',
                step: part.step,
                finishReason: part.finishReason,
              }
              break
            case 'file':
              hasEmitted = true
              yield { type: 'file', mediaType: part.mediaType, data: part.data }
              break
            case 'sources':
              hasEmitted = true
              yield { type: 'sources', sources: part.sources }
              break
            case 'error': {
              if (options.signal?.aborted) return
              const error = new LlmError(errorKind(part.kind), part.message)
              error.partialText = text
              throw error
            }
            case 'finish':
              if (part.finishReason === 'tool-calls') {
                // without a request to answer, the steps simply ran out
                if (pendingApprovalCount === 0) {
                  const error = new LlmError(
                    'step_limit',
                    'The model used up its tool steps without answering'
                  )
                  error.partialText = text
                  throw error
                }
              } else {
                ensureCompleteAnswer(part.finishReason, text)
              }
              isCompleted = true
              yield {
                type: 'finish',
                finishReason:
                  part.finishReason === 'tool-calls' ? 'tool-calls' : 'stop',
                text,
                responseMessages: part.responseMessages,
              }
              break
            default:
              break
          }
        }
        if (!isCompleted) {
          if (options.signal?.aborted) return
          ensureCompleteAnswer('unknown', text)
        }
        return
      } catch (error) {
        if (options.signal?.aborted) return
        if (signal.aborted) {
          const timeout = new LlmError(
            'timeout',
            'The language model request timed out'
          )
          timeout.partialText = text
          throw timeout
        }
        const llmError = toLlmError(error)
        if (hasEmitted || llmError.partialText) throw llmError
        firstError ??= candidateFailure(llmError, prompt)
      }
    }
    throw firstError ?? new LlmError('unknown', 'All language models failed')
  }

  /** A whole answer without streaming: nothing reaches anybody until it is over */
  async function generate(
    task: LlmRunName,
    prompt: LlmPrompt,
    options: LlmRunOptions
  ) {
    const { config, candidates, deadline, signal, checkTime } = startCall(
      task,
      options
    )
    let firstError: LlmError | undefined
    for (const model of candidates) {
      if (options.signal?.aborted) return ''
      checkTime()
      try {
        const { kit, request } = requestFor(
          config,
          task,
          model,
          prompt,
          options,
          signal,
          deadline
        )
        const result = await kit.generate(request)
        options.onModel?.({ provider: result.provider, model: result.model })
        ensureCompleteAnswer(result.finishReason, result.text)
        return result.text
      } catch (error) {
        if (options.signal?.aborted) return ''
        if (signal.aborted) {
          throw new LlmError('timeout', 'The language model request timed out')
        }
        const llmError = toLlmError(error)
        if (llmError.partialText) throw llmError
        firstError ??= candidateFailure(llmError, prompt)
      }
    }
    throw firstError ?? new LlmError('unknown', 'All language models failed')
  }

  return {
    stream,
    async run(task, prompt, options = {}) {
      if (options.signal?.aborted) return ''
      if (!options.onChunk) return generate(task, prompt, options)
      let text = ''
      for await (const event of stream(task, prompt, options)) {
        if (event.type === 'model') {
          options.onModel?.({ provider: event.provider, model: event.model })
        } else if (event.type === 'text') {
          text += event.text
          options.onChunk(event.text)
        }
      }
      return text
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
  return new LlmError('unknown', errorMessage(error), { cause: error })
}

function errorKind(kind: AiErrorKind): LlmErrorKind {
  return kind === 'no_candidates' ? 'no_model' : kind
}
