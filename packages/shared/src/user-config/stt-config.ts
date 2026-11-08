/**
 * Dictation is live only: Deepgram in the cloud, Gemini Live over WebSockets,
 * or a sherpa-onnx streaming server the user runs themselves
 */
export const STT_PROVIDERS = ['deepgram', 'sherpaOnnx', 'geminiLive'] as const

export type SttProvider = (typeof STT_PROVIDERS)[number]

export const VOICE_CORRECTION_MODES = ['live', 'onSubmit', 'off'] as const
export type VoiceCorrectionMode = (typeof VOICE_CORRECTION_MODES)[number]

export interface DeepgramSttSettings {
  /** The Deepgram model, e.g. `nova-3` */
  modelId: string
  /**
   * `auto` (the default) lets the provider detect the spoken language; anything
   * else is a locale such as `de-DE`
   */
  language: string
}

export interface SherpaOnnxSttSettings {
  /** The server, e.g. `ws://localhost:6006` */
  baseUrl: string
}

export interface GeminiLiveSttSettings {
  /** The Gemini model, e.g. `gemini-3.5-transcribe-live` */
  modelId: string
}

export interface SttConfig {
  provider: SttProvider
  /**
   * How the LLM corrects recognized speech (`llm.tasks.voiceCorrection`):
   * `live` applies contextual corrections during speech and at the end across
   * all targets; `onSubmit` runs a single pass when dictation into an external
   * window finishes; `off` disables LLM correction.
   */
  correctionMode: VoiceCorrectionMode
  /**
   * Whether holding the voice input hotkey records until released
   * (Push-to-Talk)
   */
  isVoiceInputHoldEnabled: boolean
  /**
   * Whether holding the voice commands hotkey records until released
   * (Push-to-Talk)
   */
  isVoiceCommandsHoldEnabled: boolean
  /** Whether to show the 15-key styling keyboard during hotkey voice input */
  isStylingBarEnabled: boolean
  /** Whether pressing a style key inserts the result directly without preview */
  isStylingBarDirectInsertEnabled: boolean
  providers: {
    deepgram: DeepgramSttSettings
    sherpaOnnx: SherpaOnnxSttSettings
    geminiLive: GeminiLiveSttSettings
  }
}
