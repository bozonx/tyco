import type { TranscriptPart } from '@bozonx/ai-kit'

import { joinWords } from '../text/word-spacing'

export interface LiveTranscriptState {
  /** Settled speech; the provider will not revise it */
  committed: string
  /** The provider's current guess for speech after `committed` */
  draft: string
}

export function createLiveTranscriptState(): LiveTranscriptState {
  return { committed: '', draft: '' }
}

/**
 * Folds one live transcription part into the text shown while dictating. A
 * partial replaces the previous one; a final settles its words and clears the
 * guess. Other parts do not change the text.
 */
export function applyTranscriptPart(
  state: LiveTranscriptState,
  part: TranscriptPart
): LiveTranscriptState {
  switch (part.type) {
    case 'partial':
      return { ...state, draft: part.text.trim() }
    case 'final':
      return {
        committed: joinTranscript(state.committed, part.segment.text),
        draft: '',
      }
    default:
      return state
  }
}

/** The text as it stands: settled speech, then the current guess */
export function liveTranscriptText(state: LiveTranscriptState): string {
  return joinTranscript(state.committed, state.draft)
}

/**
 * Whether `next` carries new recognized speech over `previous`. A draft cleared
 * by an empty provider result is a retracted noise guess, not new words.
 */
export function hasNewTranscriptSpeech(
  previous: LiveTranscriptState,
  next: LiveTranscriptState
): boolean {
  const nextText = liveTranscriptText(next)
  const previousText = liveTranscriptText(previous)
  if (nextText === previousText) return false
  // Retracting the draft back to `committed` without adding words is silence.
  if (next.committed === previous.committed && !next.draft) return false
  return true
}

function joinTranscript(head: string, tail: string): string {
  const next = tail.trim()
  if (!next) return head
  return joinWords(head, next)
}
