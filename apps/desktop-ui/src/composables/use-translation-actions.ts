import { translate } from '../lib/i18n'
import { handleLlmRequestError } from '../lib/llm/llm-request-error'
import { clientLogger } from '../lib/logger'
import { useIpcStore } from '../stores/ipc'
import { useTranslationStore } from '../stores/translation'
import useToast from './use-toast'

export function useTranslationActions() {
  const ipcStore = useIpcStore()
  const translationStore = useTranslationStore()
  const { toast, toastText } = useToast()
  const currentUserConfig = () => ipcStore.desktopState.userConfig
  interface TranslateOptions {
    signal?: AbortSignal
    onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
    notifyError?: boolean
    /** Detected by the translator when omitted */
    sourceLanguage?: string
  }

  /** Translates into any language, not only the configured ones */
  const translateTo = async (
    targetLanguage: string,
    text?: string,
    options: TranslateOptions = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'warn')
      return ''
    }

    try {
      return await translationStore.client.translate(text, {
        targetLanguage,
        sourceLanguage: options.sourceLanguage,
        signal: options.signal,
        onStage: options.onStage,
        rules: currentUserConfig().aiRules?.translate,
      })
    } catch (error) {
      return handleLlmRequestError(
        error,
        'Translation request failed',
        options,
        {
          translate,
          logError: (message, failure) =>
            clientLogger.error(message, failure, 'translation'),
          notifyError: (message) => toastText(message, 'error'),
        }
      )
    }
  }

  return { translateTo }
}
