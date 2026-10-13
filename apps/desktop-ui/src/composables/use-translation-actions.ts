import { translate } from '../lib/i18n'
import { LlmError, toLlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
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
      if (options.signal?.aborted) return ''
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      clientLogger.error('Translation request failed', llmError, 'translation')
      if (options.notifyError !== false) {
        toastText(formatLlmError(llmError, translate), 'error')
      }
      throw llmError
    }
  }

  return { translateTo }
}
