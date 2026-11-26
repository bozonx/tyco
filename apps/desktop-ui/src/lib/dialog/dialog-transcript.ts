/** Who spoke: the user at the microphone, or the other side of the call */
export type DialogSide = 'me' | 'remote'

export type DialogTranslationState = 'idle' | 'pending' | 'complete' | 'failed'

/** One piece of recognized speech of one side, on the dialog's clock */
export interface DialogSegment {
  id: string
  side: DialogSide
  /** Since the dialog started, by the audio of its channel */
  startMs: number
  endMs: number
  text: string
  /** `false`: the provider's current guess, which it still revises */
  isFinal: boolean
  translation?: string
  translationState: DialogTranslationState
}

/** A divider marking a resumed dialog session */
export interface DialogSessionBreak {
  id: string
  timestampMs: number
  isRecording: boolean
  recordingFile?: string
  action?: 'started' | 'resumed'
}

/** An item in the dialog feed: either a turn of speech or a session break */
export type DialogFeedItem =
  | { type: 'turn'; turn: DialogTurn }
  | { type: 'break'; sessionBreak: DialogSessionBreak }

/** Speech of one side without the other side or a long pause in between */
export interface DialogTurn {
  /** The id of its first segment: stable while the turn grows */
  id: string
  side: DialogSide
  startMs: number
  endMs: number
  segments: DialogSegment[]
}

/** A pause longer than this starts a new turn of the same side */
export const DIALOG_TURN_PAUSE_MS = 1500

/**
 * Rebuilds the turns from the timestamps of both channels. A side that
 * interrupts the other leaves both turns open: each grows by its own speech,
 * and the turns are ordered by when they began.
 */
export function buildDialogTurns(
  segments: readonly DialogSegment[],
  pauseMs = DIALOG_TURN_PAUSE_MS
): DialogTurn[] {
  const turns: DialogTurn[] = []
  const open = new Map<DialogSide, DialogTurn>()
  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    let turn = open.get(segment.side)
    const other = open.get(segment.side === 'me' ? 'remote' : 'me')
    // the other side took the word after this turn was over
    const isAnswered =
      other !== undefined &&
      turn !== undefined &&
      other.startMs >= turn.endMs &&
      segment.startMs >= other.startMs
    if (!turn || segment.startMs - turn.endMs > pauseMs || isAnswered) {
      turn = {
        id: segment.id,
        side: segment.side,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segments: [],
      }
      turns.push(turn)
      open.set(segment.side, turn)
    }
    turn.segments.push(segment)
    turn.endMs = Math.max(turn.endMs, segment.endMs)
  }
  return turns
}

/** Interleaves turns and session breaks into an ordered feed. */
export function buildDialogFeedItems(
  turns: readonly DialogTurn[],
  breaks: readonly DialogSessionBreak[]
): DialogFeedItem[] {
  if (breaks.length === 0) {
    return turns.map((turn) => ({ type: 'turn', turn }))
  }
  if (turns.length === 0) {
    return breaks.map((sessionBreak) => ({ type: 'break', sessionBreak }))
  }

  const effectiveBreaks = breaks.map((b, index) => {
    if (index === 0 && turns.length > 0 && b.timestampMs > turns[0].startMs) {
      return { ...b, timestampMs: turns[0].startMs }
    }
    return b
  })

  const items: { timestampMs: number; item: DialogFeedItem }[] = []
  for (const sessionBreak of effectiveBreaks) {
    items.push({
      timestampMs: sessionBreak.timestampMs,
      item: { type: 'break', sessionBreak },
    })
  }
  for (const turn of turns) {
    items.push({ timestampMs: turn.startMs, item: { type: 'turn', turn } })
  }
  items.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs
    }
    if (a.item.type === 'break' && b.item.type !== 'break') return -1
    if (a.item.type !== 'break' && b.item.type === 'break') return 1
    return 0
  })
  return items.map((entry) => entry.item)
}
export function turnText(turn: DialogTurn): string {
  return joinTexts(turn.segments.map((segment) => segment.text))
}

/** The translation of a turn so far; empty while nothing is translated */
export function turnTranslation(turn: DialogTurn): string {
  return joinTexts(turn.segments.map((segment) => segment.translation ?? ''))
}

/** What of a turn waits for its translation: the latest words, as said */
export function turnUntranslatedText(turn: DialogTurn): string {
  return joinTexts(
    turn.segments
      .filter((segment) => segment.translationState !== 'complete')
      .map((segment) => segment.text)
  )
}

/** The latest turn of the other side: what the subtitles show */
export function lastRemoteTurn(
  turns: readonly DialogTurn[]
): DialogTurn | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1)
    if (turns[index].side === 'remote') return turns[index]
  return undefined
}

function joinTexts(texts: readonly string[]): string {
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' ')
}

/** A recognized piece of speech as a speech provider delivers it */
export type DialogTranscriptPart =
  | { type: 'partial'; text: string; startMs: number }
  | { type: 'final'; segment: { text: string; startMs: number; endMs: number } }

export interface DialogTranscriptDependencies {
  createId: () => string
  /** Every change of the segments, with all of them */
  onChange: (segments: readonly DialogSegment[]) => void
}

export interface DialogTranscript {
  readonly segments: readonly DialogSegment[]
  /**
   * Folds in what the provider of `side` recognized, its times shifted by
   * `offsetMs`: when its connection began on the dialog's clock. Returns the
   * settled segment of a final part.
   */
  apply: (
    side: DialogSide,
    part: DialogTranscriptPart,
    offsetMs: number
  ) => DialogSegment | undefined
  /** Drops the guess of `side`: its connection is gone */
  dropDraft: (side: DialogSide) => void
  update: (
    id: string,
    patch: Partial<Pick<DialogSegment, 'translation' | 'translationState'>>
  ) => void
  /** Replaces the transcript with previously saved settled segments */
  load: (next: readonly DialogSegment[]) => void
  clear: () => void
}

/**
 * The segments of a dialog. Each side has at most one guess, which the next
 * guess replaces and a final part settles.
 */
export function createDialogTranscript(
  deps: DialogTranscriptDependencies
): DialogTranscript {
  let segments: DialogSegment[] = []
  const draftIds = new Map<DialogSide, string>()

  const commit = (next: DialogSegment[]) => {
    segments = next
    deps.onChange(segments)
  }

  const withoutDraft = (side: DialogSide) => {
    const draftId = draftIds.get(side)
    draftIds.delete(side)
    return draftId ? segments.filter((item) => item.id !== draftId) : segments
  }

  return {
    get segments() {
      return segments
    },
    apply(side, part, offsetMs) {
      const existingDraftId = draftIds.get(side)
      if (part.type === 'partial') {
        const text = part.text.trim()
        const rest = withoutDraft(side)
        if (!text) {
          if (rest !== segments) commit(rest)
          return undefined
        }
        const id = existingDraftId ?? deps.createId()
        draftIds.set(side, id)
        const startMs = Math.max(offsetMs, part.startMs + offsetMs)
        commit([
          ...rest,
          {
            id,
            side,
            startMs,
            endMs: startMs,
            text,
            isFinal: false,
            translationState: 'idle',
          },
        ])
        return undefined
      }
      const rest = withoutDraft(side)
      const text = part.segment.text.trim()
      if (!text) {
        if (rest !== segments) commit(rest)
        return undefined
      }
      const segment: DialogSegment = {
        id: existingDraftId ?? deps.createId(),
        side,
        startMs: Math.max(offsetMs, part.segment.startMs + offsetMs),
        endMs: Math.max(part.segment.endMs, part.segment.startMs) + offsetMs,
        text,
        isFinal: true,
        translationState: 'idle',
      }
      commit([...rest, segment])
      return segment
    },
    dropDraft(side) {
      const rest = withoutDraft(side)
      if (rest !== segments) commit(rest)
    },
    update(id, patch) {
      if (!segments.some((segment) => segment.id === id)) return
      commit(
        segments.map((segment) =>
          segment.id === id ? { ...segment, ...patch } : segment
        )
      )
    },
    load(next) {
      draftIds.clear()
      commit(next.map((segment) => ({ ...segment })))
    },
    clear() {
      draftIds.clear()
      commit([])
    },
  }
}
