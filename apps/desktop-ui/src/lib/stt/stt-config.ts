import type { SttConfig, SttProvider } from '@tyco/shared'

/** What dictation runs on: the chosen provider with its settings */
export interface SttModel {
  provider: SttProvider
  /** The model of the provider */
  modelId: string
  /** See `DeepgramSttSettings.language`; absent for a server without a choice */
  language?: string
  /** The address of a self-hosted server */
  baseUrl?: string
  /** System instruction for Gemini Live */
  systemInstruction?: string
}

/** A sherpa-onnx server runs the one model it was started with */
const SHERPA_ONNX_MODEL_ID = 'sherpa-onnx'

/** The model dictation uses, by the provider chosen in the settings */
export function activeSttModel(config: SttConfig): SttModel {
  if (config.provider === 'sherpaOnnx')
    return {
      provider: 'sherpaOnnx',
      modelId: SHERPA_ONNX_MODEL_ID,
      baseUrl: config.providers.sherpaOnnx.baseUrl,
    }
  if (config.provider === 'geminiLive')
    return {
      provider: 'geminiLive',
      modelId:
        config.providers.geminiLive?.modelId || 'gemini-3.5-transcribe-live',
      systemInstruction: config.providers.geminiLive?.systemInstruction,
    }
  return {
    provider: 'deepgram',
    modelId: config.providers.deepgram.modelId,
    language: config.providers.deepgram.language,
  }
}
