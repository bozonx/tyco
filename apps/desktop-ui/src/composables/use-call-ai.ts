import { getChatImage } from '../lib/chat/chat-image-storage'
import { translate } from '../lib/i18n/index'
import { LlmError, toLlmError, type LlmRunName } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import {
  CHAT_TITLE_INSTRUCTIONS,
  chatTitleSource,
  cleanGeneratedTitle,
} from '../lib/chat/chat-title'
import { buildLlmPrompt } from '../lib/llm/llm-prompt'
import { resolveLanguagePreference } from '../lib/locale/language'
import { assertSttKeyAvailable } from '../lib/stt/stt-readiness'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import {
  createLiveDictation,
  type LiveDictation,
} from '../lib/stt/live-dictation'
import { dictationLanguageFor } from '../lib/stt/dictation-language'
import type { LiveTranscriptState } from '../lib/stt/live-transcript'
import {
  buildSttCatalog,
  createSttClient,
  secretId,
  sttProviderNeedsKey,
} from '../lib/stt/stt-client'
import { createVoiceCaptureControl } from '../lib/stt/voice-capture'
import { clientLogger } from '../lib/logger/index'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { useTranslationStore } from '../stores/translation'
import { AI_TASKS } from '../types/index'
import useToast from './use-toast'
import {
  APP_CONFIG,
  type ChatMessage,
  type LocalState,
  type SttModel,
} from '@tyco/shared'

export interface DictationHandlers {
  onText: (state: LiveTranscriptState) => void
  onError: (error: Error) => void
}

/**
 * One dictation for the window, whichever caller starts, finishes or cancels
 * it. The microphone streams from Rust, and the provider socket leaves from it
 */
let sharedDictation: LiveDictation | undefined
const windowDictation = () =>
  (sharedDictation ??= createLiveDictation({
    capture: createVoiceCaptureControl(tauriNetIpc),
    stt: createSttClient({ transport: createTauriTransport(tauriNetIpc) }),
  }))

export const useCallAi = () => {
  const dictation = windowDictation()
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
    try {
      const imageBytes = new Map<string, Uint8Array<ArrayBuffer>>()
      if (typeof messages !== 'string') {
        for (const message of messages) {
          for (const image of message.images || []) {
            if (options.signal?.aborted) return ''
            if (!imageBytes.has(image.id))
              imageBytes.set(
                image.id,
                await getChatImage(image.id).catch(() => {
                  throw new LlmError(
                    'unknown',
                    translate('chat.imageUnavailable')
                  )
                })
              )
          }
        }
      }
      if (options.signal?.aborted) return ''
      const prompt = buildLlmPrompt(messages, {
        imageBytes,
        instructions: options.instructions,
        rules: options.rules,
        rulePrefix: currentAppConfig().rulePrefix,
      })

      return await llmStore.client.run(taskName, prompt, {
        models: options.models,
        onChunk: options.onChunk,
        signal: options.signal,
        onModel: options.onModel,
      })
    } catch (error) {
      if (options.signal?.aborted) return ''
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      console.error(`LLM request "${taskName}" failed`, llmError)
      clientLogger.error(`LLM request "${taskName}" failed`, llmError, 'llm')
      if (options.notifyError !== false) {
        toastText(formatLlmError(llmError, translate), 'error')
      }
      throw llmError
    }
  }

  const startDictation = async (handlers: DictationHandlers) => {
    const model = currentVoiceModel()
    try {
      buildSttCatalog(model)
    } catch {
      throw new Error(translate('toast.sttModelIncomplete'))
    }
    const needsKey = sttProviderNeedsKey(model.provider)
    if (needsKey) {
      try {
        await llmStore.refreshSecrets()
      } catch {
        throw new Error(translate('toast.voiceKeyCheckFailed'))
      }
      assertSttKeyAvailable(llmStore.secrets, secretId(model), translate)
    }

    await dictation.start({
      model,
      language: currentDictationLanguage(model),
      hasApiKey: needsKey,
      ...handlers,
      onError: (error) => {
        clientLogger.error('Speech recognition session failed', error, 'stt')
        handlers.onError(error)
      },
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
