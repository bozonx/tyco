import {
  Catalog,
  createAiKit,
  type AiKit,
  type KeyProvider,
  type Transport,
} from '@bozonx/ai-kit'
import { pcm16ToWav } from '@bozonx/ai-kit/stt'
import type { SttModel } from '@tyco/shared'

import { secretRef } from '../net/secrets'

const TRANSCRIPTION_TASK = 'transcription'

export interface VoiceRecording {
  sampleRate: number
  samples: number[]
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
    })
    if (kits.size >= 20) kits.clear()
    kits.set(key, kit)
    return kit
  }

  return {
    async transcribe(request) {
      const wav = pcm16ToWav(
        toPcm16(request.recording.samples),
        request.recording.sampleRate
      )
      const result = await kitFor(request.model).transcribe({
        source: { data: wav, mimeType: 'audio/wav' },
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

function toPcm16(samples: number[]): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2)
  const view = new DataView(pcm.buffer)

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(index * 2, Math.round(value), true)
  })

  return pcm
}
