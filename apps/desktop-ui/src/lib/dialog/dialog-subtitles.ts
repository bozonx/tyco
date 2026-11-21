import type { DialogTextDisplay, SubtitlesView } from '@tyco/shared'

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
  textDisplay: DialogTextDisplay
  isActive: boolean
  errorText: string
  labels: {
    waitingForSpeech: string
    notRunning: string
    stop: string
    expand: string
  }
}

/**
 * What the subtitles show: the latest turn of the other side, the translation
 * large and the original small under it, as the view says.
 */
export function buildSubtitlesView(input: DialogSubtitlesInput): SubtitlesView {
  const turn = lastRemoteTurn(input.turns)
  const original = turn ? turnText(turn) : ''
  const translation =
    turn && input.translationLanguage ? turnTranslation(turn) : ''
  const showsTranslation =
    Boolean(translation) && input.textDisplay !== 'original'
  return {
    mainText: showsTranslation ? translation : original,
    mainLang: showsTranslation ? input.translationLanguage : null,
    // with the translation alone, the words still waiting for it follow it
    pendingText:
      turn && showsTranslation && input.textDisplay === 'translation'
        ? turnUntranslatedText(turn)
        : '',
    secondaryText:
      showsTranslation && input.textDisplay === 'both' ? original : '',
    placeholder: input.isActive
      ? input.labels.waitingForSpeech
      : input.labels.notRunning,
    errorText: input.errorText,
    isActive: input.isActive,
    stopLabel: input.labels.stop,
    expandLabel: input.labels.expand,
  }
}
