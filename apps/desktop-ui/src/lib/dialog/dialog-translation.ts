import type { DialogSegment } from './dialog-transcript'

/** How many earlier segments of the other side the LLM sees as context */
export const DIALOG_TRANSLATION_CONTEXT_SIZE = 4

export interface DialogTranslationRequest {
  text: string
  targetLanguage: string
  /** The latest earlier segments of the other side, oldest first */
  context: readonly string[]
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
}

export interface DialogTranslationQueue {
  /** Queues a settled segment of the other side; others are left alone */
  enqueue: (segment: DialogSegment) => void
  /** Forgets what waits and what was said: a new dialog begins */
  clear: () => void
  /** Resolves once nothing waits */
  idle: () => Promise<void>
}

/**
 * Translates the settled speech of the other side one segment at a time, in the
 * order it was said. A failed segment is marked and keeps its original.
 */
export function createDialogTranslationQueue(
  deps: DialogTranslationDependencies
): DialogTranslationQueue {
  const contextSize = deps.contextSize ?? DIALOG_TRANSLATION_CONTEXT_SIZE
  let pending: DialogSegment[] = []
  let history: string[] = []
  let controller = new AbortController()
  let running: Promise<void> | undefined

  const run = async (signal: AbortSignal) => {
    for (;;) {
      const segment = pending.shift()
      if (!segment || signal.aborted) return
      const context = history.slice(-contextSize)
      history = [...history, segment.text].slice(-contextSize)
      const targetLanguage = deps.targetLanguage().trim()
      if (!targetLanguage) {
        deps.onUpdate(segment.id, { translationState: 'idle' })
        continue
      }
      try {
        const translation = await deps.translate({
          text: segment.text,
          targetLanguage,
          context,
          signal,
        })
        if (signal.aborted) return
        deps.onUpdate(segment.id, {
          translationState: 'complete',
          translation: translation.trim(),
        })
      } catch (error) {
        if (signal.aborted) return
        deps.logError?.('Could not translate a dialog segment', error)
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

  return {
    enqueue(segment) {
      if (segment.side !== 'remote' || !segment.isFinal) return
      if (!deps.targetLanguage().trim()) return
      deps.onUpdate(segment.id, { translationState: 'pending' })
      pending.push(segment)
      ensureRunning()
    },
    clear() {
      controller.abort()
      controller = new AbortController()
      pending = []
      history = []
      running = undefined
    },
    async idle() {
      while (running) await running
    },
  }
}
