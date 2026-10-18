import { createDictationController } from '../lib/stt/dictation-controller'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { useDictationStore } from '../stores/dictation'
import { useDesktopStore } from '../stores/desktop'
import { useSecretsStore } from '../stores/secrets'

export function useDictationActions() {
  const dictation = useDictationStore()
  const desktop = useDesktopStore()
  const secretsStore = useSecretsStore()
  return createDictationController({
    getConfig: () => desktop.userConfig,
    dictation: dictation.createSession(),
    refreshSecrets: secretsStore.refreshSecrets,
    getSecrets: () => secretsStore.secrets,
    translate,
    logError: (message, error) => clientLogger.error(message, error, 'stt'),
  })
}
