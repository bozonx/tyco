import { translate } from '../lib/i18n'
import { LlmError, toLlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import { buildLlmPrompt, fillTemplate } from '../lib/llm/llm-prompt'
import {
  AUTO_LANGUAGE_VALUE,
  resolveLanguagePreference,
} from '../lib/locale/language'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { AI_TASKS } from '../types'
import { transcribeOpenAiCompatible } from '../utils/stt/openai-compatible'
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
const proxiedFetch = createTauriFetch(tauriNetIpc)

interface LocalVoiceRecording {
  sampleRate: number
  samples: number[]
}

export const useCallAi = () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
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

    if (sttModel.provider === 'openai-compatible') {
      return {
        provider: 'openai-compatible' as const,
        streaming: false,
        model: sttModel,
      }
    }

    return { provider: 'websocket' as const, streaming: true, model: sttModel }
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
      toastText(formatLlmError(llmError, translate), 'error')
      throw llmError
    }
  }

  const startVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()

    if (runtime.provider === 'openai-compatible') {
      const result = await ipcStore.callFunction('startLocalVoiceRecording')

      if (!result.success) {
        throw new Error(result.error || 'Failed to start local voice recording')
      }
      return
    }

    await ipcStore.callFunction('startVoiceRecognition')
  }

  const stopVoiceRecognition = async () => {
    const runtime = getVoiceRecognitionRuntime()

    if (runtime.provider === 'openai-compatible') {
      const result = await ipcStore.callFunction('stopLocalVoiceRecording')

      if (!result.success || !result.result || !runtime.model) {
        throw new Error(result.error || 'Failed to stop local voice recording')
      }

      await llmStore.refreshSecrets()
      const text = await transcribeOpenAiCompatible(
        runtime.model,
        result.result as LocalVoiceRecording,
        currentWhisperLanguage(),
        proxiedFetch,
        Object.hasOwn(llmStore.secrets, runtime.model.id)
      )

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

    if (runtime.provider === 'openai-compatible') {
      await ipcStore.callFunction('stopLocalVoiceRecording')
      return
    }

    await ipcStore.callFunction('stopVoiceRecognition')
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
      { ...options, instructions: devInstructions, rules: buildTaskRules() }
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

  const translateText = async (toLangNum: number, text?: string) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()
    const language = userConfig.toTranslateLanguages[toLangNum]
    if (!language) return ''

    return await aiRequest(AI_TASKS.TRANSLATE, text, {
      instructions: fillTemplate(
        APP_CONFIG.aiInstructions[AI_TASKS.TRANSLATE],
        { TRANSLATION_LANG: language }
      ),
      rules: buildTaskRules(userConfig.aiRules[AI_TASKS.TRANSLATE]),
    })
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
