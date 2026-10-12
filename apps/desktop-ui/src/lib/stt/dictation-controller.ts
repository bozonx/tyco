import type { SttModel, UserConfig } from '@tyco/shared'
import { resolveLanguagePreference } from '../locale/language'
import type { SecretsStatus } from '../net/secrets'
import { assertSttKeyAvailable } from './stt-readiness'
import { dictationLanguageFor } from './dictation-language'
import type { LiveTranscriptState } from './live-transcript'
import type { LiveDictation } from './live-dictation'
import { buildSttCatalog, secretId, sttProviderNeedsKey } from './stt-client'

export interface DictationHandlers {
  onText: (state: LiveTranscriptState) => void
  onError: (error: Error) => void
}

export interface DictationControllerDependencies {
  getConfig: () => Pick<
    UserConfig,
    'aiModelUsage' | 'sttModels' | 'userLanguage'
  >
  dictation: LiveDictation
  refreshSecrets: () => Promise<unknown>
  getSecrets: () => SecretsStatus
  translate: (key: string, params?: Record<string, string | number>) => string
  logError: (message: string, error: Error) => void
}

export function createDictationController(
  deps: DictationControllerDependencies
) {
  const currentSttModel = () => {
    const userConfig = deps.getConfig()
    const modelId = userConfig.aiModelUsage.stt

    return userConfig.sttModels.find((model: SttModel) => model.id === modelId)
  }

  const shouldFormatRecognizedText = () => {
    return Boolean(currentSttModel()?.formatWithLlm)
  }

  const currentVoiceModel = () => {
    const sttModel = currentSttModel()

    if (!sttModel) {
      throw new Error(deps.translate('toast.modelNotFound'))
    }

    return sttModel
  }

  // naming the language matters: the multilingual model takes Russian for
  // Spanish and the like, so it is used only when chosen explicitly
  const currentDictationLanguage = (model: SttModel) =>
    dictationLanguageFor(
      model.language,
      resolveLanguagePreference(deps.getConfig().userLanguage)
    )

  const startDictation = async (handlers: DictationHandlers) => {
    const model = currentVoiceModel()
    try {
      buildSttCatalog(model)
    } catch {
      throw new Error(deps.translate('toast.sttModelIncomplete'))
    }
    const needsKey = sttProviderNeedsKey(model.provider)
    if (needsKey) {
      try {
        await deps.refreshSecrets()
      } catch {
        throw new Error(deps.translate('toast.voiceKeyCheckFailed'))
      }
      assertSttKeyAvailable(deps.getSecrets(), secretId(model), deps.translate)
    }

    await deps.dictation.start({
      model,
      language: currentDictationLanguage(model),
      hasApiKey: needsKey,
      ...handlers,
      onError: (error) => {
        deps.logError('Speech recognition session failed', error)
        handlers.onError(error)
      },
    })
  }

  const finishDictation = () => deps.dictation.finish()

  const cancelDictation = () => deps.dictation.cancel()

  return {
    shouldFormatRecognizedText,
    startDictation,
    finishDictation,
    cancelDictation,
  }
}
