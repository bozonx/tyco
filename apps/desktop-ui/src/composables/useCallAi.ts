import { translate } from '../lib/i18n'
import {
  AUTO_LANGUAGE_VALUE,
  resolveLanguagePreference,
} from '../lib/locale/language'
import { useIpcStore } from '../stores/ipc'
import { AI_TASKS } from '../types'
import { runBrowserLocalChatCompletion } from '../utils/llm/browser-local'
import {
  cancelBrowserWhisperRecognition,
  startBrowserWhisperRecognition,
  stopBrowserWhisperRecognition,
} from '../utils/stt/browser-whisper'
import { DEFAULT_WHISPER_LOCAL_MODEL } from '../utils/stt/model-storage'
import { GlobalEvents, useGlobalEvents } from './useGlobalEvents'
import useToast from './useToast'
import {
  APP_CONFIG,
  type ChatMessage,
  type LlmModel,
  type LocalState,
  type SttModel,
  useAiRequest,
} from '@shared'

interface LocalVoiceRecording {
  sampleRate: number
  samples: number[]
}

export const useCallAi = () => {
  const { chatCompletion, prepareAiMessages, prepareDevInstructions } =
    useAiRequest()
  const ipcStore = useIpcStore()
  const { toast } = useToast()
  const { globalEvents } = useGlobalEvents()

  const currentUserConfig = () => ipcStore.params.userConfig

  const buildTaskRules = (taskRule?: string) => {
    const baseRule = String(currentUserConfig().aiRules?.base || '').trim()
    const specificRule = String(taskRule || '').trim()

    return [baseRule, specificRule].filter(Boolean).join('\n\n')
  }

  const currentSttModel = () => {
    const userConfig = currentUserConfig()
    const modelId = userConfig.aiModelUsage.stt

    return userConfig.sttModels.find((model: SttModel) => model.id === modelId)
  }

  const shouldFormatRecognizedText = () => {
    return currentSttModel()?.formatWithLlm !== false
  }

  const getVoiceRecognitionRuntime = () => {
    const sttModel = currentSttModel()
    const provider = sttModel?.provider || sttModel?.model

    if (provider === 'whisper-local') {
      return {
        provider: 'whisper-local' as const,
        streaming: false,
        model: sttModel,
      }
    }

    return {
      provider: 'vosk' as const,
      streaming: true,
      model: sttModel,
    }
  }

  const currentWhisperLanguage = () => {
    const userLanguage = currentUserConfig().userLanguage

    if (!userLanguage || userLanguage === AUTO_LANGUAGE_VALUE) {
      return undefined
    }

    return resolveLanguagePreference(userLanguage).split('_')[0]
  }

  async function aiRequest(
    taskName: string,
    messages: string | ChatMessage[],
    options?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
      onProgress?: (progress: {
        status: string
        file?: string
        progress?: number
      }) => void
    }
  ) {
    const userConfig = currentUserConfig()
    const modelId = (userConfig.aiModelUsage as any)[taskName]
    const model = userConfig.llmModels.find(
      (model: (typeof userConfig.llmModels)[number]) => model.id === modelId
    )

    if (!model) {
      throw new Error(translate('toast.modelNotFound'))
    }

    const result = await runLlmRequest(model, messages, options)

    if (result.error) {
      toast(result.error, 'error')
      console.error(result.status + ' ' + result.statusText, result.error)

      return ''
    }

    return result.content
  }

  async function runLlmRequest(
    model: LlmModel,
    messages: string | ChatMessage[],
    options?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
      onProgress?: (progress: {
        status: string
        file?: string
        progress?: number
      }) => void
    }
  ): Promise<Record<string, any>> {
    const provider = model.provider || model.model
    const normalizedMessages = Array.isArray(messages)
      ? messages
      : [{ role: 'user', content: messages } satisfies ChatMessage]

    if (provider === 'browser-local') {
      try {
        return await runBrowserLocalChatCompletion(
          model,
          normalizedMessages,
          options
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { content: '' }
        }
        return {
          error: error instanceof Error ? error.message : String(error),
          status: 500,
          statusText: 'Browser local LLM error',
        }
      }
    }

    return await chatCompletion(model, normalizedMessages, options)
  }

  const startVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()
    const sttModel = runtime.model

    if (runtime.provider === 'whisper-local') {
      await startBrowserWhisperRecognition({
        modelName: sttModel?.localModel || DEFAULT_WHISPER_LOCAL_MODEL,
        language: currentWhisperLanguage(),
        restorePunctuation: true,
        startRecording: async () => {
          const result = await ipcStore.callFunction('startLocalVoiceRecording')

          if (!result.success) {
            throw new Error(
              result.error || 'Failed to start local voice recording'
            )
          }
        },
        stopRecording: async () => {
          const result = await ipcStore.callFunction('stopLocalVoiceRecording')

          if (!result.success || !result.result) {
            throw new Error(
              result.error || 'Failed to stop local voice recording'
            )
          }

          return result.result as LocalVoiceRecording
        },
        onText: (text) => {
          globalEvents.emit(GlobalEvents.VOICE_RECOGNITION, text)
        },
      })
      return
    }

    await ipcStore.callFunction('startVoiceRecognition')
  }

  const stopVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()

    if (runtime.provider === 'whisper-local') {
      const text = await stopBrowserWhisperRecognition()

      if (text) {
        globalEvents.emit(GlobalEvents.VOICE_RECOGNITION, text)
      }

      return text
    }

    await ipcStore.callFunction('stopVoiceRecognition')
    return ''
  }

  const cancelVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()

    if (runtime.provider === 'whisper-local') {
      await cancelBrowserWhisperRecognition()
      return
    }

    await ipcStore.callFunction('stopVoiceRecognition')
  }

  const voiceCorrection = async (text: string) => {
    const userConfig = currentUserConfig()
    const rule = buildTaskRules(userConfig.aiRules[AI_TASKS.VOICE_CORRECTION])
    const devInstructions = prepareDevInstructions(
      APP_CONFIG.aiInstructions[AI_TASKS.VOICE_CORRECTION]
    )

    return await aiRequest(
      AI_TASKS.VOICE_CORRECTION,
      prepareAiMessages(text, rule, devInstructions)
    )
  }

  const sendChatMessage = async (
    message: string,
    prevMessages: ChatMessage[],
    devInstructions?: string,
    options?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
      onProgress?: (progress: {
        status: string
        file?: string
        progress?: number
      }) => void
    }
  ) => {
    const rule = buildTaskRules()
    const result = await aiRequest(
      AI_TASKS.CHAT,
      prepareAiMessages(
        [...prevMessages, { role: 'user', content: message }],
        rule,
        devInstructions
      ),
      options
    )

    return result
  }

  const correctText = async (text: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return
    }

    const userConfig = currentUserConfig()
    const rule = buildTaskRules(userConfig.aiRules[AI_TASKS.CORRECTION])
    const devInstructions = prepareDevInstructions(
      APP_CONFIG.aiInstructions[AI_TASKS.CORRECTION]
    )

    return await aiRequest(
      AI_TASKS.CORRECTION,
      prepareAiMessages(text, rule, devInstructions)
    )
  }

  const translateText = async (toLangNum: number, text?: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return
    }

    const userConfig = currentUserConfig()
    const rule = buildTaskRules(userConfig.aiRules[AI_TASKS.TRANSLATE])
    const devInstructions = prepareDevInstructions(
      APP_CONFIG.aiInstructions[AI_TASKS.TRANSLATE],
      {
        TRANSLATION_LANG: userConfig.toTranslateLanguages[toLangNum],
      }
    )

    return await aiRequest(
      AI_TASKS.TRANSLATE,
      prepareAiMessages(text, rule, devInstructions)
    )
  }

  const aiTasks = async (presetNum: number, text?: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return
    }

    const userConfig = currentUserConfig()
    const rule = buildTaskRules(userConfig.aiTasks[presetNum].rule)
    const devInstructions = prepareDevInstructions(
      APP_CONFIG.aiInstructions[AI_TASKS.AI_TASKS]
    )

    return await aiRequest(
      AI_TASKS.AI_TASKS,
      prepareAiMessages(text, rule, devInstructions)
    )
  }

  const saveLocalState = (patch: Partial<LocalState>) => {
    return ipcStore.patchLocalState(patch)
  }

  return {
    aiRequest,
    getVoiceRecognitionRuntime,
    shouldFormatRecognizedText,
    startVoiceRecognition,
    stopVoiceRecognition,
    cancelVoiceRecognition,
    voiceCorrection,
    sendChatMessage,
    correctText,
    translateText,
    aiTasks,
    saveLocalState,
  }
}
