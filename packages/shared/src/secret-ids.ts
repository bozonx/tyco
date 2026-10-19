import type { SttProvider } from './user-config/stt-config'

/**
 * A secret is named by what it is for, `<namespace>.<name>`: an LLM provider, a
 * machine translation service, a speech service or a webhook. The Rust store
 * binds the well-known ids to their origins, see `secrets/origins.rs`
 */
export const llmSecretId = (providerId: string): string => `llm.${providerId}`

export const TRANSLATION_SECRET_IDS = {
  deepl: 'translation.deepl',
  google: 'translation.google',
} as const

export const sttSecretId = (provider: SttProvider): string => `stt.${provider}`

/** A webhook authorization key, made anew each time it is entered */
export const WEBHOOK_AUTH_SECRET_PREFIX = 'webhook.auth.'
