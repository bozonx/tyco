import {
  Catalog,
  createAiKit,
  type AiKit,
  type KeyProvider,
  type Transport,
} from '@bozonx/ai-kit'
import type { SttModel } from '@tyco/shared'

import { secretRef } from '../net/secrets'

const TRANSCRIPTION_TASK = 'transcription'
const TRANSCRIPTION_TIMEOUT_MS = 600_000

export interface VoiceRecording {
  sampleRate: number
  durationMs: number
  wav: Uint8Array
  limitReached?: boolean
}

export interface SttClientDeps {
  transport: Transport
  keys?: KeyProvider
}

export interface SttTranscribeRequest {
  model: SttModel
  recording: VoiceRecording
  language?: string
  hasApiKey?: boolean
  signal?: AbortSignal
}

export interface SttClient {
  transcribe: (request: SttTranscribeRequest) => Promise<string>
}

/** Builds a speech catalog for one user-configured OpenAI-compatible model. */
export function buildSttCatalog(model: SttModel): Catalog {
  if (!model.model.trim()) {
    throw new Error('The speech recognition model name is empty')
  }
  if (model.provider === 'openai-compatible' && !isHttpUrl(model.baseUrl)) {
    throw new Error('The speech recognition endpoint is not a valid HTTP URL')
  }

  return Catalog.fromObject({
    requirePricing: false,
    models: [
      {
        name: model.id,
        kind: 'stt',
        provider: model.provider,
        model: model.model.trim(),
        ...(model.baseUrl?.trim() ? { baseUrl: model.baseUrl.trim() } : {}),
        tier: 'standard',
        modalities: { input: ['audio'], output: ['text'] },
        sttCapabilities: { languageDetection: true, punctuation: true },
      },
    ],
    taskClasses: { [TRANSCRIPTION_TASK]: [model.id] },
  })
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function createSttClient(deps: SttClientDeps): SttClient {
  const kits = new Map<string, AiKit>()
  const defaultKeys: KeyProvider = {
    async get(provider) {
      if (provider === 'openai-compatible') return ''
      throw new Error(`No API key configured for provider "${provider}"`)
    },
  }

  const kitFor = (model: SttModel): AiKit => {
    const key = JSON.stringify({
      id: model.id,
      model: model.model,
      baseUrl: model.baseUrl,
    })
    const cached = kits.get(key)
    if (cached) return cached

    const kit = createAiKit({
      catalog: buildSttCatalog(model),
      keys: deps.keys ?? defaultKeys,
      transport: deps.transport,
      retry: { totalTimeoutMs: TRANSCRIPTION_TIMEOUT_MS },
    })
    if (kits.size >= 20) kits.clear()
    kits.set(key, kit)
    return kit
  }

  return {
    async transcribe(request) {
      validateRecording(request.recording)
      const result = await kitFor(request.model).transcribe({
        source: { data: request.recording.wav, mimeType: 'audio/wav' },
        policy: {
          mode: 'manual',
          taskClass: TRANSCRIPTION_TASK,
          requestedModel: request.model.id,
        },
        options: { language: request.language, punctuation: true },
        ...(request.hasApiKey
          ? {
              keys: {
                [request.model.provider]: secretRef(secretId(request.model)),
              },
            }
          : {}),
        ...(request.signal ? { abortSignal: request.signal } : {}),
      })

      return result.text.trim()
    },
  }
}

export function secretId(model: SttModel): string {
  return model.provider === 'openai-compatible' ? model.id : model.provider
}

function validateRecording(recording: VoiceRecording): void {
  if (!Number.isInteger(recording.sampleRate) || recording.sampleRate <= 0) {
    throw new Error('The recording has an invalid sample rate')
  }
  if (!Number.isFinite(recording.durationMs) || recording.durationMs < 100) {
    throw new Error('The recording is empty or too short')
  }
  if (recording.durationMs > 300_500) {
    throw new Error('The recording exceeds the five minute limit')
  }
  if (
    recording.wav.byteLength < 44 ||
    new TextDecoder().decode(recording.wav.subarray(0, 4)) !== 'RIFF' ||
    new TextDecoder().decode(recording.wav.subarray(8, 12)) !== 'WAVE'
  ) {
    throw new Error('The recording is not a valid WAV file')
  }
}
