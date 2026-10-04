import { translate } from '../lib/i18n'
import { LlmError, toLlmError, type LlmRunName } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import {
  CHAT_TITLE_INSTRUCTIONS,
  chatTitleSource,
  cleanGeneratedTitle,
} from '../lib/chat/chat-title'
import { buildLlmPrompt } from '../lib/llm/llm-prompt'
import { resolveLanguagePreference } from '../lib/locale/language'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { createLiveDictation } from '../lib/stt/live-dictation'
import { dictationLanguageFor } from '../lib/stt/dictation-language'
import type { LiveTranscriptState } from '../lib/stt/live-transcript'
import {
  buildSttCatalog,
  createSttClient,
  secretId,
  sttProviderNeedsKey,
} from '../lib/stt/stt-client'
import { createVoiceCaptureControl } from '../lib/stt/voice-capture'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { useTranslationStore } from '../stores/translation'
import { AI_TASKS } from '../types'
import useToast from './useToast'
import {
  APP_CONFIG,
  type ChatMessage,
  type LocalState,
  type SttModel,
} from '@tyco/shared'

/** The microphone streams from Rust, and the provider socket leaves from it */
const dictation = createLiveDictation({
  capture: createVoiceCaptureControl(tauriNetIpc),
  stt: createSttClient({ transport: createTauriTransport(tauriNetIpc) }),
})

export interface DictationHandlers {
  onText: (state: LiveTranscriptState) => void
  onError: (error: Error) => void
}

export const useCallAi = () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const translationStore = useTranslationStore()
  const { toast, toastText } = useToast()
  const currentUserConfig = () => ipcStore.params.userConfig
  const currentAppConfig = () => ipcStore.params?.appConfig ?? APP_CONFIG

  const currentSttModel = () => {
    const userConfig = currentUserConfig()
    const modelId = userConfig.aiModelUsage.stt

    return userConfig.sttModels.find((model: SttModel) => model.id === modelId)
  }

  const shouldFormatRecognizedText = () => {
    return Boolean(currentSttModel()?.formatWithLlm)
  }

  const currentVoiceModel = () => {
    const sttModel = currentSttModel()

    if (!sttModel) {
      throw new Error(translate('toast.modelNotFound'))
    }

    return sttModel
  }

  // naming the language matters: the multilingual model takes Russian for
  // Spanish and the like, so it is used only when chosen explicitly
  const currentDictationLanguage = (model: SttModel) =>
    dictationLanguageFor(
      model.language,
      resolveLanguagePreference(currentUserConfig().userLanguage)
    )

  interface AiRequestOptions {
    onChunk?: (chunk: string) => void
    signal?: AbortSignal
    onModel?: (model: { provider: string; model: string }) => void
    notifyError?: boolean
    /** Models to run on instead of the task's chain */
    models?: string[]
  }

  /** Runs a task on the configured model chain and preserves typed failures. */
  async function aiRequest(
    taskName: LlmRunName,
    messages: string | ChatMessage[],
    options: AiRequestOptions & { instructions?: string; rules?: string } = {}
  ) {
    const prompt = buildLlmPrompt(messages, {
      instructions: options.instructions,
      rules: options.rules,
      rulePrefix: currentAppConfig().rulePrefix,
    })

    try {
      return await llmStore.client.run(taskName, prompt, {
        models: options.models,
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

  const startDictation = async (handlers: DictationHandlers) => {
    const model = currentVoiceModel()
    buildSttCatalog(model)
    const needsKey = sttProviderNeedsKey(model.provider)
    if (needsKey) {
      await llmStore.refreshSecrets()
      if (!Object.hasOwn(llmStore.secrets, secretId(model))) {
        throw new Error(
          `No API key configured for provider "${model.provider}"`
        )
      }
    }

    await dictation.start({
      model,
      language: currentDictationLanguage(model),
      hasApiKey: needsKey,
      ...handlers,
    })
  }

  const finishDictation = () => dictation.finish()

  const cancelDictation = () => dictation.cancel()

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
    message: string,
    prevMessages: ChatMessage[],
    devInstructions: string | undefined,
    options: Omit<AiRequestOptions, 'models'> & { modelId: string }
  ) => {
    const { modelId, ...rest } = options
    return await aiRequest(
      AI_TASKS.CHAT,
      [...prevMessages, { role: 'user', content: message }],
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
    modelId: string
  ) => {
    const raw = await aiRequest(
      AI_TASKS.CHAT,
      chatTitleSource(question, answer),
      {
        models: [modelId],
        notifyError: false,
        instructions: CHAT_TITLE_INSTRUCTIONS,
      }
    )
    return cleanGeneratedTitle(raw)
  }

  const correctText = async (
    text: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()

    return await aiRequest(AI_TASKS.CORRECTION, text, {
      ...options,
      instructions: currentAppConfig().aiInstructions[AI_TASKS.CORRECTION],
      rules: userConfig.aiRules?.correction,
    })
  }

  const translateText = async (
    toLangNum: number,
    text?: string,
    options: {
      signal?: AbortSignal
      onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
      notifyError?: boolean
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
        rules: userConfig.aiRules?.translate,
      })
    } catch (error) {
      if (options.signal?.aborted) return ''
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      console.error('Translation request failed', llmError)
      if (options.notifyError !== false) {
        toastText(formatLlmError(llmError, translate), 'error')
      }
      throw llmError
    }
  }

  const aiTasks = async (
    presetNum: number,
    text?: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      toast('toast.textNotSelected', 'error')
      return ''
    }

    const userConfig = currentUserConfig()
    const task = userConfig.aiTasks[presetNum]
    if (!task) return ''

    return await aiRequest(AI_TASKS.AI_TASKS, text, {
      ...options,
      instructions: currentAppConfig().aiInstructions[AI_TASKS.AI_TASKS],
      rules: task.rule,
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
    translateText,
    aiTasks,
    saveLocalState,
  }
}
