import type { TranscriptPart } from '@bozonx/ai-kit'

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
        committed: joinWords(state.committed, part.segment.text),
        draft: '',
      }
    default:
      return state
  }
}

/** The text as it stands: settled speech, then the current guess */
export function liveTranscriptText(state: LiveTranscriptState): string {
  return joinWords(state.committed, state.draft)
}

/** Scripts written without spaces between words */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\u3000-\u303f\uff00-\uffef]/u

function joinWords(head: string, tail: string): string {
  const next = tail.trim()
  if (!next) return head
  if (!head) return next
  const isUnspaced =
    UNSPACED_SCRIPT.test(head.at(-1) ?? '') && UNSPACED_SCRIPT.test(next[0]!)
  return isUnspaced ? `${head}${next}` : `${head} ${next}`
}
