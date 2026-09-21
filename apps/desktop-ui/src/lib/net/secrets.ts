import type { KeyProvider } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'

import type { NetIpc } from './net-ipc'

/** Stands in for a key; the Rust proxy substitutes the value on the way out */
export const SECRET_REF_PREFIX = 'tyco-secret:'

/** Provider ids that may be called without a key by default */
export const KEYLESS_PROVIDERS: readonly string[] = ['openai-compatible']

/** What the webview may know about a secret: that it exists, and where it goes */
export interface SecretStatus {
  origins: string[]
}

export type SecretsStatus = Record<string, SecretStatus>

export function secretRef(id: string): string {
  return SECRET_REF_PREFIX + id
}

export interface SecretsClient {
  status: () => Promise<SecretsStatus>
  /**
   * Origins default to the provider's own for a known provider id and are
   * required for any other, e.g. an `openai-compatible` endpoint
   */
  set: (id: string, value: string, origins?: string[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function createSecretsClient(ipc: NetIpc): SecretsClient {
  return {
    status: () => ipc.invoke<SecretsStatus>(DESKTOP_COMMANDS.SECRETS_STATUS),
    set: (id, value, origins) =>
      ipc.invoke(DESKTOP_COMMANDS.SECRETS_SET, {
        id,
        value,
        origins: origins ?? null,
      }),
    remove: (id) => ipc.invoke(DESKTOP_COMMANDS.SECRETS_REMOVE, { id }),
  }
}

/**
 * Hands `@bozonx/ai-kit` a reference instead of a key. A provider with no
 * stored key fails here, before any request, so the kit moves on to the next
 * candidate.
 */
export function createSecretKeyProvider(
  status: () => Promise<SecretsStatus>,
  /** Whether a provider may be called without a key, e.g. a local Ollama */
  isKeyless: (provider: string) => boolean = (provider) =>
    KEYLESS_PROVIDERS.includes(provider)
): KeyProvider {
  return {
    async get(provider) {
      const secrets = await status()

      if (Object.hasOwn(secrets, provider)) {
        return secretRef(provider)
      }
      if (isKeyless(provider)) {
        return ''
      }

      throw new Error(`No API key configured for provider "${provider}"`)
    },
  }
}
