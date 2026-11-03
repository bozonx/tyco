import { AiError } from '@bozonx/ai-kit'
import type {
  ProviderStreamRequest,
  ProviderTranscribeRequest,
  SttProviderFactory,
  SttStreamEvent,
} from '@bozonx/ai-kit/stt'

export const DEFAULT_GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const nodeBuffer = (
    globalThis as unknown as {
      Buffer?: { from(data: Uint8Array): { toString(enc: string): string } }
    }
  ).Buffer
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString('base64')
  }
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

interface GeminiServerContent {
  interimInputTranscription?: { text?: string }
  inputTranscription?: { text?: string }
  modelTurn?: { parts?: Array<{ text?: string }> }
  turnComplete?: boolean
  interrupted?: boolean
}

interface GeminiLiveMessage {
  error?: { message?: string; code?: number }
  serverContent?: GeminiServerContent
  setupComplete?: Record<string, unknown>
}

export function parseGeminiLiveMessage(raw: string): GeminiLiveMessage {
  try {
    return JSON.parse(raw) as GeminiLiveMessage
  } catch {
    throw new AiError(
      'provider_unavailable',
      'Gemini Live sent a message that is not JSON',
      { provider: 'geminiLive' }
    )
  }
}

export const createGeminiLiveProvider =
  (systemInstruction?: string): SttProviderFactory =>
  (init) => {
    return {
      async transcribe(_request: ProviderTranscribeRequest) {
        throw new AiError(
          'provider_unavailable',
          'Batch transcription is not supported by Gemini Live; use streaming dictation',
          { provider: 'geminiLive' }
        )
      },

      async transcribeStream(
        request: ProviderStreamRequest
      ): Promise<AsyncIterable<SttStreamEvent>> {
        if (!init.openSocket) {
          throw new Error('Gemini Live requires the desktop socket transport')
        }

        const baseUrl = init.baseUrl?.trim() || DEFAULT_GEMINI_LIVE_URL
        const separator = baseUrl.includes('?') ? '&' : '?'
        const socketUrl = `${baseUrl}${separator}key=${init.apiKey}`

        const session = await init.openSocket(socketUrl, {
          signal: request.signal,
          connectSignal: request.connectSignal,
          headers: { 'x-goog-api-key': init.apiKey },
        })

        const rawModelId = request.modelId.trim() || 'gemini-2.0-flash'
        const modelName = rawModelId.startsWith('models/')
          ? rawModelId
          : `models/${rawModelId}`

        const setupPayload: Record<string, unknown> = {
          setup: {
            model: modelName,
            generationConfig: { responseModalities: ['TEXT'] },
            inputAudioTranscription: { mode: 'smart' },
          },
        }

        if (systemInstruction?.trim()) {
          ;(setupPayload.setup as Record<string, unknown>).systemInstruction = {
            parts: [{ text: systemInstruction.trim() }],
          }
        }

        session.send(JSON.stringify(setupPayload))

        // Pump microphone audio chunks into the socket in the background
        void (async () => {
          try {
            for await (const chunk of request.audio) {
              if (request.signal.aborted) break
              const base64 = uint8ArrayToBase64(chunk.data)
              session.send(
                JSON.stringify({
                  realtimeInput: {
                    mediaChunks: [
                      {
                        mimeType: `audio/pcm;rate=${request.sampleRate}`,
                        data: base64,
                      },
                    ],
                  },
                })
              )
            }
            if (!request.signal.aborted) {
              session.send(
                JSON.stringify({ realtimeInput: { audioStreamEnd: true } })
              )
            }
          } catch {
            // Socket or session closed
          }
        })()

        return {
          async *[Symbol.asyncIterator]() {
            let startMs = 0
            let accumulatedTurnText = ''

            try {
              for await (const raw of session.messages) {
                const message = parseGeminiLiveMessage(raw)
                if (message.error) {
                  throw new AiError(
                    'provider_unavailable',
                    message.error.message ?? 'Gemini Live returned an error',
                    { provider: 'geminiLive' }
                  )
                }

                const content = message.serverContent
                if (!content) continue

                // 1. Transcription streams (dedicated speech models)
                if (content.interimInputTranscription?.text) {
                  yield {
                    type: 'partial' as const,
                    text: content.interimInputTranscription.text,
                    startMs,
                  }
                }
                if (content.inputTranscription?.text) {
                  const text = content.inputTranscription.text
                  yield {
                    type: 'final' as const,
                    segment: { startMs, endMs: startMs + 1000, text },
                  }
                  startMs += 1000
                }

                // 2. Multimodal text turn (e.g. gemini-2.0-flash with TEXT modality)
                if (content.modelTurn?.parts) {
                  for (const part of content.modelTurn.parts) {
                    if (typeof part.text === 'string') {
                      accumulatedTurnText += part.text
                      yield {
                        type: 'partial' as const,
                        text: accumulatedTurnText,
                        startMs,
                      }
                    }
                  }
                }

                if (content.turnComplete) {
                  if (accumulatedTurnText.trim()) {
                    yield {
                      type: 'final' as const,
                      segment: {
                        startMs,
                        endMs: startMs + 1000,
                        text: accumulatedTurnText.trim(),
                      },
                    }
                    accumulatedTurnText = ''
                    startMs += 1000
                  }
                }
              }

              // Flush any remaining partial on stream close
              if (accumulatedTurnText.trim()) {
                yield {
                  type: 'final' as const,
                  segment: {
                    startMs,
                    endMs: startMs + 1000,
                    text: accumulatedTurnText.trim(),
                  },
                }
              }
            } finally {
              session.close()
            }
          },
        }
      },
    }
  }
