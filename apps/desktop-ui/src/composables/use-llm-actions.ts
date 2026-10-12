import { getChatImage } from '../lib/chat/chat-image-storage'
import { translate } from '../lib/i18n/index'
import {
  CHAT_TITLE_INSTRUCTIONS,
  chatTitleSource,
  cleanGeneratedTitle,
} from '../lib/chat/chat-title'
import { createLlmRequest, type AiRequestOptions } from '../lib/llm/llm-request'
import { clientLogger } from '../lib/logger/index'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { AI_TASKS } from '../types/index'
import useToast from './use-toast'
import { APP_CONFIG, type ChatMessage } from '@tyco/shared'

export const useLlmActions = () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const { toast, toastText } = useToast()
  const currentUserConfig = () => ipcStore.params.userConfig
  const currentAppConfig = () => ipcStore.params?.appConfig ?? APP_CONFIG

  const aiRequest = createLlmRequest({
    client: llmStore.client,
    getImage: getChatImage,
    rulePrefix: () => currentAppConfig().rulePrefix,
    translate,
    logError: (message, error) => {
      clientLogger.error(message, error, 'llm')
    },
    notifyError: (message) => toastText(message, 'error'),
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

  return {
    aiRequest,
    voiceCorrection,
    sendChatMessage,
    generateChatTitle,
    correctText,
    aiCustomPrompt,
  }
}
