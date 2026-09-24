import { translate } from '../lib/i18n'
import { LlmError, toLlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import { buildLlmPrompt } from '../lib/llm/llm-prompt'
import {
  AUTO_LANGUAGE_VALUE,
  resolveLanguagePreference,
} from '../lib/locale/language'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { createSttClient, secretId } from '../lib/stt/stt-client'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { useTranslationStore } from '../stores/translation'
import { AI_TASKS } from '../types'
import { GlobalEvents, useGlobalEvents } from './useGlobalEvents'
import useToast from './useToast'
import {
  APP_CONFIG,
  type ChatMessage,
  type LlmTask,
  type LocalState,
  type SttModel,
} from '@tyco/shared'

/** Speech recognition requests leave from Rust too, like every other one */
const sttClient = createSttClient({
  transport: createTauriTransport(tauriNetIpc),
})

interface LocalVoiceRecording {
  sampleRate: number
  samples: number[]
}

export const useCallAi = () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const translationStore = useTranslationStore()
  const { toast, toastText } = useToast()
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

    if (!sttModel) {
      throw new Error(translate('toast.modelNotFound'))
    }

    return { streaming: false, model: sttModel }
  }

  const currentWhisperLanguage = () => {
    const userLanguage = currentUserConfig().userLanguage

    if (!userLanguage || userLanguage === AUTO_LANGUAGE_VALUE) {
      return undefined
    }

    return resolveLanguagePreference(userLanguage).split('_')[0]
  }

  interface AiRequestOptions {
    onChunk?: (chunk: string) => void
    signal?: AbortSignal
    onModel?: (model: { provider: string; model: string }) => void
    notifyError?: boolean
  }

  /** Runs a task on the configured model chain and preserves typed failures. */
  async function aiRequest(
    taskName: LlmTask,
    messages: string | ChatMessage[],
    options: AiRequestOptions & { instructions?: string; rules?: string } = {}
  ) {
    const prompt = buildLlmPrompt(messages, {
      instructions: options.instructions,
      rules: options.rules,
      rulePrefix: APP_CONFIG.rulePrefix,
    })

    try {
      return await llmStore.client.run(taskName, prompt, {
        onChunk: options.onChunk,
        signal: options.signal,
        onModel: options.onModel,
      })
    } catch (error) {
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      console.error(`LLM request "${taskName}" failed`, llmError)
      if (options.notifyError !== false) {
        toastText(formatLlmError(llmError, translate), 'error')
      }
      throw llmError
    }
  }

  const startVoiceRecognition = async () => {
    getVoiceRecognitionRuntime()

    const result = await ipcStore.callFunction('startLocalVoiceRecording')

    if (!result.success) {
      throw new Error(result.error || 'Failed to start local voice recording')
    }
  }

  const stopVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()

    const result = await ipcStore.callFunction('stopLocalVoiceRecording')

    if (!result.success || !result.result) {
      throw new Error(result.error || 'Failed to stop local voice recording')
    }

    await llmStore.refreshSecrets()
    const text = await sttClient.transcribe({
      model: runtime.model,
      recording: result.result as LocalVoiceRecording,
      language: currentWhisperLanguage(),
      hasApiKey: Object.hasOwn(llmStore.secrets, secretId(runtime.model)),
    })

    if (text) {
      globalEvents.emit(GlobalEvents.VOICE_RECOGNITION, text)
    }

    return text
  }

  const cancelVoiceRecognition = async () => {
    getVoiceRecognitionRuntime()
    await ipcStore.callFunction('stopLocalVoiceRecording')
  }

  const voiceCorrection = async (text: string) => {
    const userConfig = currentUserConfig()

    return await aiRequest(AI_TASKS.VOICE_CORRECTION, text, {
      instructions: APP_CONFIG.aiInstructions[AI_TASKS.VOICE_CORRECTION],
      rules: buildTaskRules(userConfig.aiRules[AI_TASKS.VOICE_CORRECTION]),
    })
  }

  const sendChatMessage = async (
    message: string,
    prevMessages: ChatMessage[],
    devInstructions?: string,
    options?: AiRequestOptions
  ) => {
    return await aiRequest(
      AI_TASKS.CHAT,
      [...prevMessages, { role: 'user', content: message }],
      {
        ...options,
        notifyError: false,
        instructions: devInstructions,
        rules: buildTaskRules(),
      }
    )
  }

  const correctText = async (text: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()

    return await aiRequest(AI_TASKS.CORRECTION, text, {
      instructions: APP_CONFIG.aiInstructions[AI_TASKS.CORRECTION],
      rules: buildTaskRules(userConfig.aiRules[AI_TASKS.CORRECTION]),
    })
  }

  const translateText = async (
    toLangNum: number,
    text?: string,
    options: {
      signal?: AbortSignal
      onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
    } = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()
    const language = userConfig.toTranslateLanguages[toLangNum]
    if (!language) return ''

    try {
      return await translationStore.client.translate(text, {
        targetLanguage: language,
        signal: options.signal,
        onStage: options.onStage,
        rules: buildTaskRules(userConfig.aiRules[AI_TASKS.TRANSLATE]),
      })
    } catch (error) {
      if (options.signal?.aborted) return ''
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      console.error('Translation request failed', llmError)
      toastText(formatLlmError(llmError, translate), 'error')
      throw llmError
    }
  }

  const aiTasks = async (presetNum: number, text?: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()
    const task = userConfig.aiTasks[presetNum]
    if (!task) return ''

    return await aiRequest(AI_TASKS.AI_TASKS, text, {
      instructions: APP_CONFIG.aiInstructions[AI_TASKS.AI_TASKS],
      rules: buildTaskRules(task.rule),
    })
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
