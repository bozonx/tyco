import { APP_CONFIG } from '@tyco/shared'
import { getChatImage } from '../lib/chat/chat-image-storage'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { createLlmActions } from '../lib/llm/llm-actions'
import { createLlmRequest } from '../lib/llm/llm-request'
import { useToastStore } from './toast'
import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { createLlmClient, isKeylessProvider } from '../lib/llm/llm-client'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { createSecretKeyProvider } from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useDesktopStore } from './desktop'
import { useSecretsStore } from './secrets'

export const useLlmStore = defineStore('llm', () => {
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()

  const getConfig = () => normalizeLlmConfig(desktopStore.userConfig?.llm)
  const client = createLlmClient({
    getConfig,
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(
      () => secretsStore.client.status(),
      (provider) => isKeylessProvider(getConfig(), provider)
    ),
  })

  const toast = useToastStore()
  const getAppConfig = () => desktopStore.appConfig ?? APP_CONFIG
  const aiRequest = createLlmRequest({
    client,
    getImage: getChatImage,
    rulePrefix: () => getAppConfig().rulePrefix,
    translate,
    logError: (message, error) => clientLogger.error(message, error, 'llm'),
    notifyError: (message) => toast.addToast(message, 'error'),
  })
  const actions = createLlmActions({
    aiRequest,
    getUserConfig: () => desktopStore.userConfig,
    getAppConfig,
    notifyEmptyText: () =>
      toast.addToast(translate('toast.textNotSelected'), 'warn'),
  })
  return { client: markRaw(client), actions: markRaw(actions) }
})
