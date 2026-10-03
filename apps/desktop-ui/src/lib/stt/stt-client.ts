import {
  type AudioChunk,
  Catalog,
  createAiKit,
  type AiKit,
  type KeyProvider,
  type TranscriptPart,
  type Transport,
} from '@bozonx/ai-kit'
import type { SttModel, SttProvider } from '@tyco/shared'

import { secretRef } from '../net/secrets'

const TRANSCRIPTION_TASK = 'transcription'
/** Covers opening the provider socket only; the session itself has no limit */
const CONNECT_TIMEOUT_MS = 20_000
/**
 * Deepgram's multilingual model. Named explicitly: a live session cannot detect
 * the language, and the kit's batch fallback (`detect_language`) is ignored
 * there, leaving English.
 */
const MULTILINGUAL_LANGUAGE = 'multi'
/** Self-hosted servers: reached by the configured address, without a key */
const KEYLESS_STT_PROVIDERS: readonly SttProvider[] = ['sherpa-onnx']

/** Whether dictation with this provider needs an API key */
export function sttProviderNeedsKey(provider: SttProvider): boolean {
  return !KEYLESS_STT_PROVIDERS.includes(provider)
}

export interface SttClientDeps {
  transport: Transport
  keys?: KeyProvider
}

export interface SttLiveRequest {
  model: SttModel
  /** PCM16 mono, ending when the dictation does */
  audio: AsyncIterable<AudioChunk>
  sampleRate: number
  /** Omitted: the provider's multilingual model follows the speech */
  language?: string
  hasApiKey?: boolean
  signal?: AbortSignal
}

export interface SttClient {
  transcribeLive: (request: SttLiveRequest) => AsyncIterable<TranscriptPart>
}

/** Builds a speech catalog for the one configured live model. */
export function buildSttCatalog(model: SttModel): Catalog {
  if (!model.model.trim()) {
    throw new Error('The speech recognition model name is empty')
  }
  const baseUrl = model.baseUrl?.trim()
  if (!sttProviderNeedsKey(model.provider) && !baseUrl) {
    throw new Error('The speech recognition server address is empty')
  }

  return Catalog.fromObject({
    requirePricing: false,
    models: [
      {
        name: model.id,
        kind: 'stt',
        provider: model.provider,
        model: model.model.trim(),
        ...(baseUrl ? { baseUrl } : {}),
        tier: 'standard',
        modalities: { input: ['audio'], output: ['text'] },
        sttCapabilities: {
          realtime: true,
          languageDetection: true,
          punctuation: true,
        },
      },
    ],
    taskClasses: { [TRANSCRIPTION_TASK]: [model.id] },
  })
}

export function createSttClient(deps: SttClientDeps): SttClient {
  const kits = new Map<string, AiKit>()
  const defaultKeys: KeyProvider = {
    async get(provider) {
      if (!sttProviderNeedsKey(provider as SttProvider)) return ''
      throw new Error(`No API key configured for provider "${provider}"`)
    },
  }

  const kitFor = (model: SttModel): AiKit => {
    const key = JSON.stringify({
      id: model.id,
      provider: model.provider,
      model: model.model,
      baseUrl: model.baseUrl,
    })
    const cached = kits.get(key)
    if (cached) return cached

    const kit = createAiKit({
      catalog: buildSttCatalog(model),
      keys: deps.keys ?? defaultKeys,
      transport: deps.transport,
      retry: { totalTimeoutMs: CONNECT_TIMEOUT_MS },
    })
    if (kits.size >= 20) kits.clear()
    kits.set(key, kit)
    return kit
  }

  return {
    transcribeLive(request) {
      return kitFor(request.model).transcribeStream({
        audio: request.audio,
        sampleRate: request.sampleRate,
        policy: {
          mode: 'manual',
          taskClass: TRANSCRIPTION_TASK,
          requestedModel: request.model.id,
        },
        options: {
          language: request.language ?? MULTILINGUAL_LANGUAGE,
          punctuation: true,
        },
        ...(request.hasApiKey
          ? {
              keys: {
                [request.model.provider]: secretRef(secretId(request.model)),
              },
            }
          : {}),
        ...(request.signal ? { abortSignal: request.signal } : {}),
      })
    },
  }
}

export function secretId(model: SttModel): string {
  return model.provider
}
