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
   * `auto` (the default) follows the user language, `multi` lets the
   * multilingual model guess; anything else is a locale such as `de_DE`
   */
  language: string
}

export interface SherpaOnnxSttSettings {
  /** The server, e.g. `ws://localhost:6006` */
  baseUrl: string
}

export interface SttConfig {
  provider: SttProvider
  /** The LLM turns the transcript into written text */
  isLlmFormattingEnabled: boolean
  providers: {
    deepgram: DeepgramSttSettings
    sherpaOnnx: SherpaOnnxSttSettings
  }
}
