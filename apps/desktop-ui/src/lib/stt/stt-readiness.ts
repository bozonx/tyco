import { sttSecretId, type SttProvider } from '@tyco/shared'

import { isSecretUsable, type SecretsStatus } from '../net/secrets'
import { DictationError } from './dictation-error'

/** How the user knows the providers that take a key */
const STT_PROVIDER_LABELS: Record<SttProvider, string> = {
  deepgram: 'Deepgram',
  sherpaOnnx: 'sherpa-onnx',
  geminiLive: 'Gemini Live',
}

/** Checks credentials before opening the microphone or contacting the provider. */
export function assertSttKeyAvailable(
  secrets: SecretsStatus,
  provider: SttProvider,
  translate: (key: string, params?: Record<string, string | number>) => string
): void {
  const id = sttSecretId(provider)
  if (isSecretUsable(secrets, id)) return
  const hasSaved = Object.hasOwn(secrets, id)
  const key = hasSaved ? 'toast.voiceKeyUnavailable' : 'toast.voiceKeyMissing'
  const providerLabel = Object.hasOwn(STT_PROVIDER_LABELS, provider)
    ? STT_PROVIDER_LABELS[provider]
    : provider
  throw new DictationError(
    hasSaved ? 'keyUnavailable' : 'missingKey',
    translate(key, { provider: providerLabel })
  )
}
