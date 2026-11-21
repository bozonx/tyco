import type { EditorHistoryDialog, EditorHistoryEntry } from '@tyco/shared'

/** How often a running dialog reaches the history while it has new turns */
export const DIALOG_HISTORY_INTERVAL_MS = 15_000

export interface DialogHistoryDependencies {
  /** Upserts the entry; the id it holds, `null` when nothing was stored */
  save: (entry: EditorHistoryEntry) => Promise<string | null>
  /** The finished turns of the session as text; the guesses are left out */
  getText: () => string
  reportError: (error: unknown) => void
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  intervalMs?: number
}

export interface DialogHistory {
  /** Ends the previous session, if any, and opens a new one */
  begin: (session: EditorHistoryDialog) => Promise<void>
  /** Writes the session when its text changed since the last write */
  checkpoint: () => Promise<void>
  /** A last checkpoint; the session stays closed until `begin` */
  end: () => Promise<void>
  dispose: () => void
}

interface Session {
  meta: EditorHistoryDialog
  /** The entry's id once it was stored */
  id?: string
  savedText: string
  /** The user deleted the entry: the session is not written again */
  isDropped: boolean
}

/**
 * The history entry of a dialog session: one per Start, created with the first
 * finished turn and rewritten under its id as more follow. A session that
 * recognized nothing leaves no entry.
 */
export function createDialogHistory(
  deps: DialogHistoryDependencies
): DialogHistory {
  const startInterval =
    deps.setInterval ??
    ((callback: () => void, ms: number) => globalThis.setInterval(callback, ms))
  const stopInterval =
    deps.clearInterval ??
    ((handle: unknown) =>
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>))
  let session: Session | undefined
  let timer: unknown
  // writes go one after another: an id comes back before the next one
  let pending = Promise.resolve()

  const stopTimer = () => {
    if (timer === undefined) return
    stopInterval(timer)
    timer = undefined
  }

  const write = (target: Session): Promise<void> => {
    pending = pending.then(async () => {
      if (target.isDropped) return
      const text = deps.getText()
      if (!text.trim() || text === target.savedText) return
      try {
        const id = await deps.save({
          ...(target.id && { id: target.id }),
          text,
          kind: 'dialog',
          dialog: target.meta,
        })
        target.savedText = text
        // nothing stored under a known id: the entry was deleted
        if (id === null && target.id) target.isDropped = true
        else if (id !== null) target.id = id
      } catch (error) {
        deps.reportError(error)
      }
    })
    return pending
  }

  const end = async () => {
    stopTimer()
    const ending = session
    if (!ending) return pending
    await write(ending)
    // a session begun meanwhile stays open
    if (session === ending) session = undefined
  }

  return {
    async begin(meta) {
      await end()
      session = { meta, savedText: '', isDropped: false }
      const current = session
      timer = startInterval(() => {
        void write(current)
      }, deps.intervalMs ?? DIALOG_HISTORY_INTERVAL_MS)
    },
    checkpoint: () => (session ? write(session) : pending),
    end,
    dispose() {
      stopTimer()
      session = undefined
    },
  }
}
