import type { UserConfig } from '@tyco/shared'
import type { SecretsStatus } from '../net/secrets'
import { assertSttKeyAvailable } from './stt-readiness'
import { dictationLanguageFor } from './dictation-language'
import type { LiveTranscriptState } from './live-transcript'
import type { LiveDictation } from './live-dictation'
import { buildSttCatalog, isKeyRequiredForSttProvider } from './stt-client'
import { activeSttModel, type SttModel } from './stt-config'

export interface DictationHandlers {
  onText: (state: LiveTranscriptState) => void
  onError: (error: Error) => void
}

export interface DictationControllerDependencies {
  getConfig: () => Pick<UserConfig, 'stt'>
  dictation: LiveDictation
  refreshSecrets: () => Promise<unknown>
  getSecrets: () => SecretsStatus
  translate: (key: string, params?: Record<string, string | number>) => string
  logError: (message: string, error: Error) => void
}

export function createDictationController(
  deps: DictationControllerDependencies
) {
  let generation = 0
  const shouldFormatRecognizedText = () =>
    deps.getConfig().stt.isVoiceCorrectionEnabled

  const currentDictationLanguage = (model: SttModel) =>
    dictationLanguageFor(model.language)

  const startDictation = async (handlers: DictationHandlers) => {
    const runGeneration = ++generation
    const model = activeSttModel(deps.getConfig().stt)
    try {
      buildSttCatalog(model)
    } catch {
      throw new Error(deps.translate('toast.sttModelIncomplete'))
    }
    const needsKey = isKeyRequiredForSttProvider(model.provider)
    if (needsKey) {
      try {
        await deps.refreshSecrets()
      } catch {
        throw new Error(deps.translate('toast.voiceKeyCheckFailed'))
      }
      assertSttKeyAvailable(deps.getSecrets(), model.provider, deps.translate)
    }

    if (runGeneration !== generation) return
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

  const cancelDictation = () => {
    generation += 1
    return deps.dictation.cancel()
  }

  return {
    shouldFormatRecognizedText,
    startDictation,
    finishDictation,
    cancelDictation,
  }
}
