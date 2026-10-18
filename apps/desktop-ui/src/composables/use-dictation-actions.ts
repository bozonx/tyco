import { createDictationController } from '../lib/stt/dictation-controller'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { useDictationStore } from '../stores/dictation'
import { useIpcStore } from '../stores/ipc'
import { useSecretsStore } from '../stores/secrets'

export function useDictationActions() {
  const dictation = useDictationStore()
  const ipc = useIpcStore()
  const secretsStore = useSecretsStore()
  return createDictationController({
    getConfig: () => ipc.desktopState.userConfig,
    dictation: dictation.createSession(),
    refreshSecrets: secretsStore.refreshSecrets,
    getSecrets: () => secretsStore.secrets,
    translate,
    logError: (message, error) => clientLogger.error(message, error, 'stt'),
  })
}
