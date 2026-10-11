import { isSecretUsable, type SecretsStatus } from '../net/secrets'

/** Checks credentials before opening the microphone or contacting the provider. */
export function assertSttKeyAvailable(
  secrets: SecretsStatus,
  provider: string,
  translate: (key: string, params?: Record<string, string | number>) => string
): void {
  if (isSecretUsable(secrets, provider)) return
  const key = Object.hasOwn(secrets, provider)
    ? 'toast.voiceKeyUnavailable'
    : 'toast.voiceKeyMissing'
  throw new Error(translate(key, { provider }))
}
