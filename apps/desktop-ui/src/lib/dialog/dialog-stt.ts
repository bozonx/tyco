import type { SttConfig } from '@tyco/shared'

import type { SecretsStatus } from '../net/secrets'
import { DictationError } from '../stt/dictation-error'
import { dictationLanguageFor } from '../stt/dictation-language'
import { buildSttCatalog, isKeyRequiredForSttProvider } from '../stt/stt-client'
import { activeSttModel, type SttModel } from '../stt/stt-config'
import { assertSttKeyAvailable } from '../stt/stt-readiness'
import type { DialogSide } from './dialog-transcript'

/** How the channels of a dialog are transcribed */
export interface DialogStt {
  model: SttModel
  hasApiKey: boolean
  /** The language of a side; `undefined`: the provider follows the speech */
  languageOf: (side: DialogSide) => string | undefined
}

export interface DialogSttDependencies {
  getConfig: () => SttConfig
  getRemoteLanguage?: () => string | undefined
  /** The language the user speaks; empty: the language of the dictation */
  getOwnLanguage?: () => string | undefined
  refreshSecrets: () => Promise<unknown>
  getSecrets: () => SecretsStatus
  translate: (key: string, params?: Record<string, string | number>) => string
}

/**
 * The speech recognition of the settings, checked before the dialog records: a
 * model that can be reached and a key it can use. The user speaks the language
 * picked for the dialog, else that of the dictation; the other side may speak
 * any language.
 */
export async function resolveDialogStt(
  deps: DialogSttDependencies
): Promise<DialogStt> {
  const model = activeSttModel(deps.getConfig())
  try {
    buildSttCatalog(model)
  } catch {
    throw new DictationError(
      'incompleteConfig',
      deps.translate('toast.sttModelIncomplete')
    )
  }
  const hasApiKey = isKeyRequiredForSttProvider(model.provider)
  if (hasApiKey) {
    try {
      await deps.refreshSecrets()
    } catch {
      throw new Error(deps.translate('toast.voiceKeyCheckFailed'))
    }
    assertSttKeyAvailable(deps.getSecrets(), model.provider, deps.translate)
  }
  const ownLanguage = dictationLanguageFor(
    deps.getOwnLanguage?.()?.trim() || model.language
  )
  const rawRemote = deps.getRemoteLanguage?.()?.trim()
  const remoteLanguage =
    rawRemote && rawRemote !== 'auto'
      ? dictationLanguageFor(rawRemote)
      : undefined
  return {
    model,
    hasApiKey,
    languageOf: (side) => (side === 'me' ? ownLanguage : remoteLanguage),
  }
}
