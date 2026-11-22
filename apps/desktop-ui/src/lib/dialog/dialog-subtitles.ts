import type { SubtitlesView } from '@tyco/shared'

import {
  lastRemoteTurn,
  turnText,
  turnTranslation,
  turnUntranslatedText,
  type DialogTurn,
} from './dialog-transcript'

export interface DialogSubtitlesInput {
  turns: readonly DialogTurn[]
  /** The language translated into; empty: no translation */
  translationLanguage: string
  /** The translation is shown without the original under it */
  isTranslationOnly: boolean
  isActive: boolean
  errorText: string
  /** When the session began recording to a file; none: not recorded */
  recordingStartedAtMs?: number
  labels: {
    waitingForSpeech: string
    notRunning: string
    stop: string
    expand: string
    recording: string
  }
}

/**
 * What the subtitles show: the latest turn of the other side, the translation
 * large and the original small under it unless the translation is alone.
 */
export function buildSubtitlesView(input: DialogSubtitlesInput): SubtitlesView {
  const turn = lastRemoteTurn(input.turns)
  const original = turn ? turnText(turn) : ''
  const translation =
    turn && input.translationLanguage ? turnTranslation(turn) : ''
  const showsTranslation = Boolean(translation)
  return {
    mainText: showsTranslation ? translation : original,
    mainLang: showsTranslation ? input.translationLanguage : null,
    // with the translation alone, the words still waiting for it follow it
    pendingText:
      turn && showsTranslation && input.isTranslationOnly
        ? turnUntranslatedText(turn)
        : '',
    secondaryText: showsTranslation && !input.isTranslationOnly ? original : '',
    placeholder: input.isActive
      ? input.labels.waitingForSpeech
      : input.labels.notRunning,
    errorText: input.errorText,
    isActive: input.isActive,
    stopLabel: input.labels.stop,
    expandLabel: input.labels.expand,
    recordingStartedAt: input.recordingStartedAtMs ?? null,
    recordingLabel: input.labels.recording,
  }
}
