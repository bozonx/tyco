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

import { buildLlmCatalog, buildProviderFactories } from './llm-catalog'
import type { LlmPrompt } from './llm-prompt'

/**
 * A whole answer may take a while on a slow local model; ai-kit's own default
 * budget is meant for a server
 */
const CALL_TIMEOUT_MS = 300_000

export type LlmErrorKind =
  Exclude<AiErrorKind, 'no_candidates'> | 'no_model' | 'config' | 'unknown'

export class LlmError extends Error {
  readonly kind: LlmErrorKind

  constructor(kind: LlmErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export interface LlmClientDeps {
  getConfig: () => LlmConfig
  transport: Transport
  keys: KeyProvider
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

export interface LlmRunOptions {
  /** Streams the answer; each piece of text as it arrives */
  onChunk?: (text: string) => void
  signal?: AbortSignal
}

export interface LlmClient {
  /**
   * Runs a task on its model chain. Resolves with the text produced so far when
   * aborted
   *
   * @throws LlmError
   */
  run: (
    task: LlmTask,
    prompt: LlmPrompt,
    options?: LlmRunOptions
  ) => Promise<string>
}

export function createLlmClient(deps: LlmClientDeps): LlmClient {
  let cachedKey: string | undefined
  let cachedKit: AiKit | null = null

  /** Rebuilt when the config changes, reused otherwise */
  const kitFor = (config: LlmConfig): AiKit => {
    const key = JSON.stringify(config)

    if (key !== cachedKey) {
      try {
        const catalog = buildLlmCatalog(config)
        cachedKit =
          catalog &&
          createAiKit({
            catalog,
            keys: deps.keys,
            transport: deps.transport,
            providers: buildProviderFactories(config),
            retry: { totalTimeoutMs: CALL_TIMEOUT_MS },
          })
      } catch (error) {
        throw toLlmError(error)
      }
      cachedKey = key
    }

    if (!cachedKit) {
      throw new LlmError('no_model', 'No language model is configured')
    }
    return cachedKit
  }

  return {
    async run(task, prompt, options = {}) {
      const config = deps.getConfig()
      const kit = kitFor(config)
      const primary = config.models.find(
        (model) => model.id === config.tasks[task]?.[0]
      )
      const request: StreamRequest = {
        name: task,
        policy: { taskClass: task },
        ...prompt,
        ...(primary?.temperature === undefined
          ? {}
          : { temperature: primary.temperature }),
        ...(primary?.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: primary.maxOutputTokens }),
        ...(options.signal ? { abortSignal: options.signal } : {}),
      }

      if (!options.onChunk) {
        try {
          return (await kit.generate(request)).text
        } catch (error) {
          if (options.signal?.aborted) return ''
          throw toLlmError(error)
        }
      }

      let text = ''
      try {
        for await (const part of kit.stream(request)) {
          if (part.type === 'text-delta') {
            text += part.text
            options.onChunk(part.text)
          } else if (part.type === 'error') {
            if (part.kind === 'aborted') return text
            throw new LlmError(errorKind(part.kind), part.message)
          }
        }
      } catch (error) {
        if (options.signal?.aborted) return text
        throw toLlmError(error)
      }
      return text
    },
  }
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
