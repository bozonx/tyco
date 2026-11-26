import type { SubtitlesView } from '@tyco/shared'

import type { DialogSegment, DialogTurn } from './dialog-transcript'

/**
 * Pause longer than this starts fresh subtitles instead of rolling onto the
 * previous remote turn, so a short breath does not wipe a translation the user
 * just started reading.
 */
export const SUBTITLES_CONTINUITY_PAUSE_MS = 8000

/** Maximum trailing remote segments kept in the subtitles window */
export const SUBTITLES_MAX_SEGMENTS = 8

export interface DialogSubtitlesInput {
  turns: readonly DialogTurn[]
  /** The language translated into; empty: no translation */
  translationLanguage: string
  /** Whether a translation model is configured; defaults to true */
  hasTranslationModel?: boolean
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

function joinTexts(texts: readonly string[]): string {
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' ')
}

function collectSubtitleSegments(
  turns: readonly DialogTurn[]
): DialogSegment[] {
  const remoteTurns = turns.filter((turn) => turn.side === 'remote')
  if (remoteTurns.length === 0) return []

  const recentTurns: DialogTurn[] = [remoteTurns[remoteTurns.length - 1]]
  for (let index = remoteTurns.length - 2; index >= 0; index -= 1) {
    const previous = remoteTurns[index]
    const next = recentTurns[0]
    if (next.startMs - previous.endMs > SUBTITLES_CONTINUITY_PAUSE_MS) break
    recentTurns.unshift(previous)
  }

  return recentTurns
    .flatMap((turn) => turn.segments)
    .slice(-SUBTITLES_MAX_SEGMENTS)
}

/**
 * What the subtitles show: a rolling stream of the latest remote speech, with
 * settled translations large, trailing untranslated/interim words dimmed after
 * them, and the settled original small underneath unless translation-only.
 */
export function buildSubtitlesView(input: DialogSubtitlesInput): SubtitlesView {
  const segments = collectSubtitleSegments(input.turns)
  const isTranslationEnabled = Boolean(
    input.translationLanguage && (input.hasTranslationModel ?? true)
  )

  let mainText = ''
  let mainLang: string | null = null
  let pendingText = ''
  let secondaryText = ''

  if (segments.length > 0) {
    if (isTranslationEnabled) {
      let lastSettledIndex = -1
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const state = segments[index].translationState
        if (state === 'complete' || state === 'failed') {
          lastSettledIndex = index
          break
        }
      }

      const settledSegments =
        lastSettledIndex >= 0 ? segments.slice(0, lastSettledIndex + 1) : []
      const trailingSegments = segments.slice(lastSettledIndex + 1)

      const hasCompleteTranslation = settledSegments.some(
        (segment) =>
          segment.translationState === 'complete' &&
          Boolean(segment.translation?.trim())
      )

      mainText = joinTexts(
        settledSegments.map((segment) =>
          segment.translationState === 'complete'
            ? (segment.translation ?? '')
            : segment.text
        )
      )
      mainLang = hasCompleteTranslation ? input.translationLanguage : null
      pendingText = joinTexts(trailingSegments.map((segment) => segment.text))
      secondaryText =
        hasCompleteTranslation && !input.isTranslationOnly
          ? joinTexts(settledSegments.map((segment) => segment.text))
          : ''
    } else {
      let lastFinalIndex = -1
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        if (segments[index].isFinal) {
          lastFinalIndex = index
          break
        }
      }

      const finalSegments =
        lastFinalIndex >= 0 ? segments.slice(0, lastFinalIndex + 1) : []
      const draftSegments = segments.slice(lastFinalIndex + 1)

      mainText = joinTexts(finalSegments.map((segment) => segment.text))
      pendingText = joinTexts(draftSegments.map((segment) => segment.text))
    }
  }

  return {
    mainText,
    mainLang,
    pendingText,
    secondaryText,
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
