/**
 * Dictation is live only: Deepgram in the cloud, or a sherpa-onnx streaming
 * server the user runs themselves
 */
export const STT_PROVIDERS = ['deepgram', 'sherpaOnnx'] as const

export type SttProvider = (typeof STT_PROVIDERS)[number]

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

export interface SttConfig {
  provider: SttProvider
  /**
   * The LLM turns the transcript into written text; its settings are
   * `llm.tasks.voiceCorrection`
   */
  isVoiceCorrectionEnabled: boolean
  /** Whether to show the 15-key styling keyboard during hotkey voice input */
  isStylingBarEnabled: boolean
  /** Whether pressing a style key inserts the result directly without preview */
  isStylingBarDirectInsertEnabled: boolean
  providers: {
    deepgram: DeepgramSttSettings
    sherpaOnnx: SherpaOnnxSttSettings
  }
}
