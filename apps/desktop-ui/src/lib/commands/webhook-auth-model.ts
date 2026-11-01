import { ref } from 'vue'
import { WEBHOOK_AUTH_SECRET_PREFIX } from '@tyco/shared'
import { httpOrigin } from '../net/secrets'

export interface WebhookAuthDependencies {
  getUrl: () => string
  getSecretId: () => string
  /** The origins a stored secret is bound to; empty when unknown */
  getSecretOrigins?: (id: string) => string[]
  /** Whether the saved config still refers to the secret anywhere */
  isSecretReferenced?: (id: string) => boolean
  createId: () => string
  setSecret: (id: string, value: string, origins: string[]) => Promise<void>
  removeSecret: (id: string) => Promise<void>
  update: (field: string, value: unknown) => void
  afterRender: () => Promise<void>
  persist: () => Promise<unknown>
  isSaved: () => boolean
  notifyInvalidOrigin: () => void
  /** A key is stored on this device only: other devices keep their own */
  notifySavedOnDevice?: () => void
  reportSaveError: (error: unknown) => void
  reportRemoveError: (error: unknown) => void
}

/**
 * Keeps credentials behind the secret store and removes them only after the
 * config that no longer refers to them is saved. The id of a key is made once,
 * with the reference to it, and never changes: the config is shared by every
 * device, each keeping its own value under that id
 */
export function createWebhookAuthModel(deps: WebhookAuthDependencies) {
  const authDraft = ref('')

  /** Removes a secret once the saved config no longer refers to it */
  async function removeUnusedSecret(id: string) {
    if (!id) return
    await deps.afterRender()
    await deps.persist()
    if (!deps.isSaved() || deps.isSecretReferenced?.(id)) return
    await deps.removeSecret(id)
  }

  async function saveAuth() {
    const value = authDraft.value.trim()
    if (!value) return
    const origin = httpOrigin(deps.getUrl())
    if (!origin) {
      deps.notifyInvalidOrigin()
      return
    }
    const existingId = deps.getSecretId()
    try {
      // a new value goes under the id the config has, on this device only
      const id = existingId || `${WEBHOOK_AUTH_SECRET_PREFIX}${deps.createId()}`
      await deps.setSecret(id, value, [origin])
      if (!existingId) {
        deps.update('authSecretId', id)
        await deps.afterRender()
      }
      authDraft.value = ''
      deps.update('isAuthEnabled', true)
      deps.notifySavedOnDevice?.()
    } catch (error) {
      deps.reportSaveError(error)
    }
  }

  async function removeAuth() {
    const id = deps.getSecretId()
    try {
      deps.update('isAuthEnabled', false)
      await deps.afterRender()
      deps.update('authSecretId', undefined)
      await removeUnusedSecret(id)
    } catch (error) {
      deps.reportRemoveError(error)
    }
  }

  /**
   * Puts a new value under a secret the config refers to, keeping its id, so a
   * secret header never turns into plain text in the config. The value is
   * stored at once, on this device only, bound to the origin of the URL the
   * webhook has here; a URL without one stores nothing
   */
  async function replaceSecret(id: string, value: string) {
    const trimmed = value.trim()
    if (!id || !trimmed) return false
    const origin = httpOrigin(deps.getUrl())
    if (!origin) {
      deps.notifyInvalidOrigin()
      return false
    }
    try {
      await deps.setSecret(id, trimmed, [origin])
      deps.notifySavedOnDevice?.()
      return true
    } catch (error) {
      deps.reportSaveError(error)
      return false
    }
  }

  return {
    authDraft,
    saveAuth,
    removeAuth,
    replaceSecret,
    removeUnusedSecret: (id: string) =>
      removeUnusedSecret(id).catch(deps.reportRemoveError),
  }
}
