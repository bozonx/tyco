import { createDictationController } from '../lib/stt/dictation-controller'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { useDictationStore } from '../stores/dictation'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'

export type { DictationHandlers } from '../lib/stt/dictation-controller'

export function useDictationActions() {
  const dictation = useDictationStore()
  const ipc = useIpcStore()
  const llm = useLlmStore()
  return createDictationController({
    getConfig: () => ipc.params.userConfig,
    dictation,
    refreshSecrets: llm.refreshSecrets,
    getSecrets: () => llm.secrets,
    translate,
    logError: (message, error) => clientLogger.error(message, error, 'stt'),
  })
}
