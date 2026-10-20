import { ref } from 'vue'
import { WEBHOOK_AUTH_SECRET_PREFIX } from '@tyco/shared'
import { httpOrigin } from '../net/secrets'

export interface WebhookAuthDependencies {
  getUrl: () => string
  getSecretId: () => string
  createId: () => string
  setSecret: (id: string, value: string, origins: string[]) => Promise<void>
  removeSecret: (id: string) => Promise<void>
  update: (field: string, value: unknown) => void
  afterRender: () => Promise<void>
  persist: () => Promise<unknown>
  isSaved: () => boolean
  notifyInvalidOrigin: () => void
  reportError: (error: unknown) => void
}

/**
 * Keeps credentials behind the secret store and removes them only after
 * persistence.
 */
export function createWebhookAuthModel(deps: WebhookAuthDependencies) {
  const authDraft = ref('')
  async function saveAuth() {
    const value = authDraft.value.trim()
    if (!value) return
    const origin = httpOrigin(deps.getUrl())
    if (!origin) {
      deps.notifyInvalidOrigin()
      return
    }
    try {
      const id = `${WEBHOOK_AUTH_SECRET_PREFIX}${deps.createId()}`
      await deps.setSecret(id, value, [origin])
      deps.update('authSecretId', id)
      await deps.afterRender()
      authDraft.value = ''
      deps.update('isAuthEnabled', true)
    } catch (error) {
      deps.reportError(error)
    }
  }
  async function removeAuth() {
    try {
      const id = deps.getSecretId()
      deps.update('isAuthEnabled', false)
      await deps.afterRender()
      await deps.persist()
      if (deps.isSaved() && id) await deps.removeSecret(id)
    } catch (error) {
      deps.reportError(error)
    }
  }
  return { authDraft, saveAuth, removeAuth }
}
