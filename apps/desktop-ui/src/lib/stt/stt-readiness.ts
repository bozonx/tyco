import { sttSecretId, type SttProvider } from '@tyco/shared'

import { isSecretUsable, type SecretsStatus } from '../net/secrets'

/** How the user knows the providers that take a key */
const STT_PROVIDER_LABELS: Record<SttProvider, string> = {
  deepgram: 'Deepgram',
  sherpaOnnx: 'sherpa-onnx',
}

/** Checks credentials before opening the microphone or contacting the provider. */
export function assertSttKeyAvailable(
  secrets: SecretsStatus,
  provider: SttProvider,
  translate: (key: string, params?: Record<string, string | number>) => string
): void {
  const id = sttSecretId(provider)
  if (isSecretUsable(secrets, id)) return
  const key = Object.hasOwn(secrets, id)
    ? 'toast.voiceKeyUnavailable'
    : 'toast.voiceKeyMissing'
  const providerLabel = Object.hasOwn(STT_PROVIDER_LABELS, provider)
    ? STT_PROVIDER_LABELS[provider]
    : provider
  throw new Error(translate(key, { provider: providerLabel }))
}
