import { createSmartEndpoint } from './smart-endpoint'
import { AiError } from '@bozonx/ai-kit'
import type {
  ProviderStreamRequest,
  ProviderTranscribeRequest,
  SttProviderFactory,
  SttStreamEvent,
} from '@bozonx/ai-kit/stt'

export const DEFAULT_GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'

export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.5-transcribe-live'

export const DEFAULT_STT_FALLBACK_INSTRUCTION =
  "You are an expert real-time speech-to-text dictation engine. Transcribe the user's speech accurately into written text.\n- Correct slip-ups, stutters, and filler words.\n- Intelligently format code, variable names, and CLI commands.\n- Transcribe technical and programming terms accurately in English.\n- Insert proper punctuation and natural capitalization.\n- Output ONLY the transcribed text without any conversational preamble or notes."

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

        const rawModelId = request.modelId.trim() || DEFAULT_GEMINI_LIVE_MODEL
        const modelName = rawModelId.startsWith('models/')
          ? rawModelId
          : `models/${rawModelId}`

        const manualEndpointing = rawModelId.includes('transcribe')
        const endpoint = createSmartEndpoint(request.sampleRate)
        let pendingTurns = 0
        const sendActivity = (activity: 'activityStart' | 'activityEnd') => {
          session.send(JSON.stringify({ realtimeInput: { [activity]: {} } }))
          if (activity === 'activityEnd') pendingTurns += 1
        }

        const language = request.options?.language?.trim()
        const isAuto = !language || language === 'auto' || language === 'multi'

        const transcriptionConfig: Record<string, unknown> = {
          mode: 'SMART',
          ...(isAuto ? {} : { languageCodes: [language] }),
        }

        const setupPayload: Record<string, unknown> = {
          setup: {
            model: modelName,
            generationConfig: { responseModalities: ['TEXT'] },
            inputAudioTranscription: transcriptionConfig,
            ...(manualEndpointing
              ? {
                  realtimeInputConfig: {
                    automaticActivityDetection: { disabled: true },
                  },
                }
              : {}),
          },
        }

        const effectiveInstruction =
          systemInstruction?.trim() ||
          (rawModelId.includes('transcribe')
            ? undefined
            : DEFAULT_STT_FALLBACK_INSTRUCTION)

        if (effectiveInstruction) {
          ;(setupPayload.setup as Record<string, unknown>).systemInstruction = {
            parts: [{ text: effectiveInstruction }],
          }
        }

        let resolveSetup: () => void = () => {}
        let rejectSetup: (error: unknown) => void = () => {}
        const setupCompletePromise = new Promise<void>((resolve, reject) => {
          resolveSetup = resolve
          rejectSetup = reject
        })

        void setupCompletePromise.catch(() => undefined)

        let resolveAudioComplete: () => void = () => {}
        const audioComplete = new Promise<IteratorResult<string>>((resolve) => {
          resolveAudioComplete = () => resolve({ done: true, value: undefined })
        })
        let audioEnded = false
        let closed = false
        let rejectFailure: (error: unknown) => void = () => {}
        const failure = new Promise<never>((_, reject) => {
          rejectFailure = reject
        })
        // The consumer may not have started reading yet.
        void failure.catch(() => undefined)
        const onAbort = () => {
          const error = new Error('Aborted')
          rejectSetup(error)
          rejectFailure(error)
        }

        if (request.signal.aborted) {
          onAbort()
        } else {
          request.signal.addEventListener('abort', onAbort, { once: true })
        }

        // Pump microphone audio chunks into the socket once setup completes
        void (async () => {
          try {
            session.send(JSON.stringify(setupPayload))
            await setupCompletePromise
            let prefix = new Uint8Array(0)
            const sendAudio = (data: Uint8Array) =>
              session.send(
                JSON.stringify({
                  realtimeInput: {
                    mediaChunks: [
                      {
                        mimeType: `audio/pcm;rate=${request.sampleRate}`,
                        data: uint8ArrayToBase64(data),
                      },
                    ],
                  },
                })
              )
            for await (const chunk of request.audio) {
              if (request.signal.aborted || closed) break
              const boundary = manualEndpointing
                ? endpoint.push(chunk.data)
                : undefined
              if (boundary?.skip) {
                // Keep 200 ms before the detected onset, including soft consonants.
                const combined = new Uint8Array(
                  prefix.length + chunk.data.length
                )
                combined.set(prefix)
                combined.set(chunk.data, prefix.length)
                prefix = combined.slice(
                  -Math.floor(request.sampleRate * 0.2) * 2
                )
                continue
              }
              if (boundary?.start) {
                sendActivity('activityStart')
                if (prefix.length) sendAudio(prefix)
                prefix = new Uint8Array(0)
              }
              sendAudio(chunk.data)
              if (boundary?.end) sendActivity('activityEnd')
            }
            if (!request.signal.aborted && !closed) {
              audioEnded = true
              if (manualEndpointing) {
                if (endpoint.active) sendActivity('activityEnd')
                if (pendingTurns === 0) resolveAudioComplete()
              } else {
                session.send(
                  JSON.stringify({ realtimeInput: { audioStreamEnd: true } })
                )
              }
            }
          } catch (error) {
            if (!closed) rejectFailure(error)
          }
        })()

        return {
          async *[Symbol.asyncIterator]() {
            let startMs = 0
            let accumulatedTurnText = ''

            try {
              const messages = session.messages[Symbol.asyncIterator]()
              for (;;) {
                const next = await Promise.race([
                  messages.next(),
                  failure,
                  audioComplete,
                ])
                if (next.done) break
                const raw = next.value
                const message = parseGeminiLiveMessage(raw)
                if (message.error) {
                  const error = new AiError(
                    'provider_unavailable',
                    message.error.message ?? 'Gemini Live returned an error',
                    { provider: 'geminiLive' }
                  )
                  rejectSetup(error)
                  throw error
                }

                if (message.setupComplete) {
                  resolveSetup()
                  continue
                }

                const content = message.serverContent
                if (!content) continue
                if (content.turnComplete && manualEndpointing)
                  pendingTurns = Math.max(0, pendingTurns - 1)
                const isLastTurn =
                  audioEnded &&
                  content.turnComplete &&
                  (!manualEndpointing || pendingTurns === 0)

                // If server sends content without explicit setupComplete, release pump
                resolveSetup()

                if (content.interrupted) {
                  accumulatedTurnText = ''
                  continue
                }

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
                  // Turns during recording must not terminate the session.
                  if (isLastTurn) return
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
              closed = true
              request.signal.removeEventListener('abort', onAbort)
              rejectSetup(new Error('Session closed'))
              session.close()
            }
          },
        }
      },
    }
  }
