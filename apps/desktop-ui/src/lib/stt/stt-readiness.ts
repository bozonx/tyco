import { sttSecretId, type SttProvider } from '@tyco/shared'

import { isSecretUsable, type SecretsStatus } from '../net/secrets'

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
  throw new Error(translate(key, { provider }))
}
