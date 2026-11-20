import {
  DIALOG_TURN_PAUSE_MS,
  type DialogSegment,
  type DialogSide,
} from './dialog-transcript'

/** How many earlier lines of the dialog the translation sees as context */
export const DIALOG_TRANSLATION_CONTEXT_SIZE = 6
/** How many waiting segments one request may take, so a backlog catches up */
export const DIALOG_TRANSLATION_BATCH_SIZE = 6

/** An earlier line of the dialog, of either side */
export interface DialogContextLine {
  side: DialogSide
  text: string
}

export interface DialogTranslationRequest {
  text: string
  targetLanguage: string
  /** The latest earlier lines of both sides, oldest first */
  context: readonly DialogContextLine[]
  signal: AbortSignal
}

export interface DialogTranslationDependencies {
  translate: (request: DialogTranslationRequest) => Promise<string>
  /** The language to translate into now; empty: translation is off */
  targetLanguage: () => string
  onUpdate: (
    id: string,
    patch: Pick<DialogSegment, 'translationState'> &
      Partial<Pick<DialogSegment, 'translation'>>
  ) => void
  logError?: (message: string, error: unknown) => void
  contextSize?: number
  batchSize?: number
}

export interface DialogTranslationQueue {
  /**
   * Takes a settled segment: the other side's is translated, the user's only
   * gives context to what follows
   */
  enqueue: (segment: DialogSegment) => void
  /** Translates a segment whose translation failed once more */
  retry: (segment: DialogSegment) => void
  /** Forgets what waits and what was said: a new dialog begins */
  clear: () => void
  /** Resolves once nothing waits */
  idle: () => Promise<void>
}

interface PendingSegment {
  segment: DialogSegment
  /** How many lines of the user came before it: a reply ends a batch */
  ownLinesBefore: number
}

/**
 * Translates the settled speech of the other side in the order it was said.
 * While a request runs, what the other side says next waits; the next request
 * takes all of it that belongs together, so the translation never falls further
 * behind than one request. A failed segment is marked and keeps its original.
 */
export function createDialogTranslationQueue(
  deps: DialogTranslationDependencies
): DialogTranslationQueue {
  const contextSize = deps.contextSize ?? DIALOG_TRANSLATION_CONTEXT_SIZE
  const batchSize = deps.batchSize ?? DIALOG_TRANSLATION_BATCH_SIZE
  let pending: PendingSegment[] = []
  let history: DialogContextLine[] = []
  let ownLines = 0
  let controller = new AbortController()
  let running: Promise<void> | undefined

  const remember = (line: DialogContextLine) => {
    history = [...history, line].slice(-contextSize)
  }

  /** The next segments that read as one: no reply or long pause in between */
  const takeBatch = (): DialogSegment[] => {
    const batch = [pending.shift()!]
    while (pending.length > 0 && batch.length < batchSize) {
      const previous = batch[batch.length - 1]
      const next = pending[0]
      const isTogether =
        next.ownLinesBefore === previous.ownLinesBefore &&
        next.segment.startMs - previous.segment.endMs <= DIALOG_TURN_PAUSE_MS
      if (!isTogether) break
      batch.push(pending.shift()!)
    }
    return batch.map((item) => item.segment)
  }

  const run = async (signal: AbortSignal) => {
    while (pending.length > 0 && !signal.aborted) {
      const segments = takeBatch()
      const targetLanguage = deps.targetLanguage().trim()
      if (!targetLanguage) {
        for (const segment of segments)
          deps.onUpdate(segment.id, { translationState: 'idle' })
        continue
      }
      const text = segments.map((segment) => segment.text).join(' ')
      const context = history.slice(-contextSize)
      remember({ side: 'remote', text })
      try {
        const translation = await deps.translate({
          text,
          targetLanguage,
          context,
          signal,
        })
        if (signal.aborted) return
        // the first segment carries the whole translation, the turn joins them
        segments.forEach((segment, index) =>
          deps.onUpdate(segment.id, {
            translationState: 'complete',
            translation: index === 0 ? translation.trim() : '',
          })
        )
      } catch (error) {
        if (signal.aborted) return
        deps.logError?.('Could not translate a dialog segment', error)
        for (const segment of segments)
          deps.onUpdate(segment.id, { translationState: 'failed' })
      }
    }
  }

  const ensureRunning = () => {
    if (running) return
    const signal = controller.signal
    running = run(signal).finally(() => {
      running = undefined
      if (pending.length > 0 && !signal.aborted) ensureRunning()
    })
  }

  const queue = (segment: DialogSegment) => {
    deps.onUpdate(segment.id, { translationState: 'pending' })
    pending.push({ segment, ownLinesBefore: ownLines })
    ensureRunning()
  }

  return {
    enqueue(segment) {
      if (!segment.isFinal) return
      if (segment.side === 'me') {
        ownLines += 1
        remember({ side: 'me', text: segment.text })
        return
      }
      if (!deps.targetLanguage().trim()) return
      queue(segment)
    },
    retry(segment) {
      if (segment.side !== 'remote' || !segment.isFinal) return
      if (!deps.targetLanguage().trim()) return
      // a retried segment stands alone: what came after it is said already
      ownLines += 1
      queue(segment)
      ownLines += 1
    },
    clear() {
      controller.abort()
      controller = new AbortController()
      pending = []
      history = []
      ownLines = 0
      running = undefined
    },
    async idle() {
      while (running) await running
    },
  }
}
