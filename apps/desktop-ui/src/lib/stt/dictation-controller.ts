import type { UserConfig } from '@tyco/shared'
import type { SecretsStatus } from '../net/secrets'
import { DictationError } from './dictation-error'
import { assertSttKeyAvailable } from './stt-readiness'
import { dictationLanguageFor } from './dictation-language'
import type { LiveTranscriptState } from './live-transcript'
import type { LiveDictation, LiveDictationStart } from './live-dictation'
import { buildSttCatalog, isKeyRequiredForSttProvider } from './stt-client'
import { activeSttModel, type SttModel } from './stt-config'
import type { DictationTarget } from './dictation-target'

export interface DictationHandlers extends Pick<
  LiveDictationStart,
  'microphoneId' | 'source' | 'onWaiting' | 'onSourceLost' | 'isContinuous'
> {
  onText: (state: LiveTranscriptState) => void
  onError: (error: Error) => void
  /**
   * The language setting to recognize in place of the user's own, such as the
   * language of the computer sound; `auto` lets the provider detect it
   */
  language?: string
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
  /**
   * Single-pass LLM formatting applies to dictation into external windows only,
   * by design: in the chat and the editor the text stays editable in place and
   * goes on to the user's own actions, so it is inserted as recognized.
   */
  const shouldFormatRecognizedText = (target: DictationTarget = 'external') =>
    target === 'external' && deps.getConfig().stt.correctionMode === 'onSubmit'

  const currentDictationLanguage = (model: SttModel, setting?: string) =>
    // only a provider with a choice of language takes another one
    dictationLanguageFor(
      model.language !== undefined && setting !== undefined
        ? setting
        : model.language
    )

  const startDictation = async ({
    language: languageSetting,
    ...handlers
  }: DictationHandlers) => {
    const runGeneration = ++generation
    const sttConfig = deps.getConfig().stt
    const model = activeSttModel(sttConfig)
    try {
      buildSttCatalog(model)
    } catch {
      throw new DictationError(
        'incompleteConfig',
        deps.translate('toast.sttModelIncomplete')
      )
    }
    const needsKey = isKeyRequiredForSttProvider(model.provider)
    if (needsKey) {
      try {
        await deps.refreshSecrets()
      } catch {
        if (runGeneration !== generation) return
        throw new Error(deps.translate('toast.voiceKeyCheckFailed'))
      }
      if (runGeneration !== generation) return
      assertSttKeyAvailable(deps.getSecrets(), model.provider, deps.translate)
    }

    if (runGeneration !== generation) return
    await deps.dictation.start({
      model,
      microphoneId: sttConfig.microphoneId,
      language: currentDictationLanguage(model, languageSetting),
      hasApiKey: needsKey,
      ...handlers,
      onError: (error) => {
        deps.logError('Speech recognition session failed', error)
        handlers.onError(error)
      },
    })
  }

  const finishDictation = () => {
    // A stop during credential preflight must revoke that pending start too.
    generation += 1
    return deps.dictation.finish()
  }
  const switchSource: LiveDictation['switchSource'] = (source) =>
    deps.dictation.switchSource(source)

  const cancelDictation = () => {
    generation += 1
    return deps.dictation.cancel()
  }

  return {
    shouldFormatRecognizedText,
    shouldCorrectContextually: () =>
      deps.getConfig().stt.correctionMode === 'live',
    startDictation,
    finishDictation,
    cancelDictation,
    switchSource,
  }
}
