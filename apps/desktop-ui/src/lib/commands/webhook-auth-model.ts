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
  reportSaveError: (error: unknown) => void
  reportRemoveError: (error: unknown) => void
}

/**
 * Keeps credentials behind the secret store and removes them only after the
 * config that no longer refers to them is saved
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
    const previousId = deps.getSecretId()
    try {
      const id = `${WEBHOOK_AUTH_SECRET_PREFIX}${deps.createId()}`
      await deps.setSecret(id, value, [origin])
      deps.update('authSecretId', id)
      await deps.afterRender()
      authDraft.value = ''
      deps.update('isAuthEnabled', true)
    } catch (error) {
      deps.reportSaveError(error)
      return
    }
    if (previousId) {
      await removeUnusedSecret(previousId).catch(deps.reportRemoveError)
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
   * Puts a new value under a stored secret, keeping its id and origins, so a
   * secret header never turns into plain text in the config
   */
  async function replaceSecret(id: string, value: string) {
    const trimmed = value.trim()
    if (!id || !trimmed) return false
    const known = deps.getSecretOrigins?.(id) ?? []
    const origin = httpOrigin(deps.getUrl())
    const origins = known.length ? known : origin ? [origin] : []
    if (!origins.length) {
      deps.notifyInvalidOrigin()
      return false
    }
    try {
      await deps.setSecret(id, trimmed, origins)
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
