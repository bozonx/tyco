import { getChatImage } from '../lib/chat/chat-image-storage'
import { translate } from '../lib/i18n/index'
import { LlmError, toLlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import {
  CHAT_TITLE_INSTRUCTIONS,
  chatTitleSource,
  cleanGeneratedTitle,
} from '../lib/chat/chat-title'
import { createLlmRequest, type AiRequestOptions } from '../lib/llm/llm-request'
import { createDictationController } from '../lib/stt/dictation-controller'
import { clientLogger } from '../lib/logger/index'
import { useIpcStore } from '../stores/ipc'
import { useDictationStore } from '../stores/dictation'
import { useLlmStore } from '../stores/llm'
import { useTranslationStore } from '../stores/translation'
import { AI_TASKS } from '../types/index'
import useToast from './use-toast'
import { APP_CONFIG, type ChatMessage, type LocalState } from '@tyco/shared'

export type { DictationHandlers } from '../lib/stt/dictation-controller'

export const useCallAi = () => {
  const dictation = useDictationStore()
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const translationStore = useTranslationStore()
  const { toast, toastText } = useToast()
  const currentUserConfig = () => ipcStore.params.userConfig
  const currentAppConfig = () => ipcStore.params?.appConfig ?? APP_CONFIG

  const aiRequest = createLlmRequest({
    client: llmStore.client,
    getImage: getChatImage,
    rulePrefix: () => currentAppConfig().rulePrefix,
    translate,
    logError: (message, error) => {
      console.error(message, error)
      clientLogger.error(message, error, 'llm')
    },
    notifyError: (message) => toastText(message, 'error'),
  })
  const {
    shouldFormatRecognizedText,
    startDictation,
    finishDictation,
    cancelDictation,
  } = createDictationController({
    getConfig: currentUserConfig,
    dictation,
    refreshSecrets: () => llmStore.refreshSecrets(),
    getSecrets: () => llmStore.secrets,
    translate,
    logError: (message, error) => clientLogger.error(message, error, 'stt'),
  })

  const voiceCorrection = async (text: string, signal?: AbortSignal) => {
    const userConfig = currentUserConfig()

    return await aiRequest(AI_TASKS.VOICE_CORRECTION, text, {
      instructions:
        currentAppConfig().aiInstructions[AI_TASKS.VOICE_CORRECTION],
      rules: userConfig.aiRules?.voiceCorrection,
      signal,
    })
  }

  const sendChatMessage = async (
    message: string | ChatMessage,
    prevMessages: ChatMessage[],
    devInstructions: string | undefined,
    options: Omit<AiRequestOptions, 'models'> & { modelId: string }
  ) => {
    const { modelId, ...rest } = options
    return await aiRequest(
      AI_TASKS.CHAT,
      [
        ...prevMessages,
        typeof message === 'string'
          ? { role: 'user', content: message }
          : message,
      ],
      {
        ...rest,
        models: [modelId],
        notifyError: false,
        instructions:
          devInstructions ?? currentAppConfig().aiInstructions[AI_TASKS.CHAT],
        rules: currentUserConfig().aiRules?.chat,
      }
    )
  }

  /** A short title for a conversation; empty when none came out */
  const generateChatTitle = async (
    question: string,
    answer: string,
    modelId: string,
    signal?: AbortSignal
  ) => {
    const raw = await aiRequest(
      AI_TASKS.CHAT,
      chatTitleSource(question, answer),
      {
        models: [modelId],
        notifyError: false,
        instructions: CHAT_TITLE_INSTRUCTIONS,
        signal,
      }
    )
    return cleanGeneratedTitle(raw)
  }

  const correctText = async (
    text: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'warn')
      return ''
    }

    const userConfig = currentUserConfig()

    return await aiRequest(AI_TASKS.CORRECTION, text, {
      ...options,
      instructions: currentAppConfig().aiInstructions[AI_TASKS.CORRECTION],
      rules: userConfig.aiRules?.correction,
    })
  }

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
      console.error('Translation request failed', llmError)
      clientLogger.error('Translation request failed', llmError, 'translation')
      if (options.notifyError !== false) {
        toastText(formatLlmError(llmError, translate), 'error')
      }
      throw llmError
    }
  }

  /** Applies an own request typed in the AI task menu, like a task's rule */
  const aiCustomPrompt = async (
    prompt: string,
    text?: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'warn')
      return ''
    }
    if (!prompt.trim()) return ''

    return await aiRequest(AI_TASKS.AI_TASKS, text, {
      ...options,
      instructions: currentAppConfig().aiInstructions[AI_TASKS.AI_TASKS],
      rules: prompt.trim(),
    })
  }

  const saveLocalState = (patch: Partial<LocalState>) => {
    return ipcStore.patchLocalState(patch)
  }

  return {
    aiRequest,
    shouldFormatRecognizedText,
    startDictation,
    finishDictation,
    cancelDictation,
    voiceCorrection,
    sendChatMessage,
    generateChatTitle,
    correctText,
    translateTo,
    aiCustomPrompt,
    saveLocalState,
  }
}
