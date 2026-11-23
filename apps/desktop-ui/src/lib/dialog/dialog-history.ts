import type { EditorHistoryDialog, EditorHistoryEntry } from '@tyco/shared'

/** How often a running dialog reaches the history while it has new turns */
export const DIALOG_HISTORY_INTERVAL_MS = 15_000

export interface DialogHistoryDependencies {
  /** Upserts the entry; the id it holds, `null` when nothing was stored */
  save: (entry: EditorHistoryEntry) => Promise<string | null>
  /** The finished turns of the session as text; the guesses are left out */
  getText: () => string
  reportError: (error: unknown) => void
  /**
   * The recording of the session got no entry: the first write failed or stored
   * nothing. Called once a session; the file waits unnamed
   */
  onRecordingUnlinked?: () => void
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  intervalMs?: number
}

export interface DialogHistory {
  /** Ends the previous session, if any, and opens a new one */
  begin: (session: EditorHistoryDialog) => Promise<void>
  /**
   * Opens the session `end` closed again, so that a dialog resumed after it
   * goes on in the same entry; false when there is none to reopen
   */
  resume: () => boolean
  /**
   * Adds another recording file to the current session; `isIncomplete`: it
   * stopped before its run began
   */
  addRecording: (
    file: string,
    options?: { isIncomplete?: boolean }
  ) => Promise<void>
  /** Writes the session when its text changed since the last write */
  checkpoint: () => Promise<void>
  /** A last checkpoint; the session stays closed until `begin` */
  end: () => Promise<void>
  /** The recording `file` stopped early: the entry tells so */
  markRecordingIncomplete: (file: string) => Promise<void>
  dispose: () => void
}

interface Session {
  meta: EditorHistoryDialog
  /** The entry's id once it was stored */
  id?: string
  /** The text last written; none: the entry was never written */
  savedText?: string
  savedMeta?: EditorHistoryDialog
  /** `onRecordingUnlinked` was called */
  isUnlinkReported?: boolean
}

/**
 * The history entry of a dialog session: one per Start, created with the first
 * finished turn and rewritten under its id as more follow. A session that
 * recognized nothing leaves no entry unless it was recorded: the entry is the
 * way back to the file.
 */
function withFile(files: readonly string[] | undefined, file: string) {
  return files?.includes(file) ? [...files] : [...(files ?? []), file]
}

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
  /** The session `end` closed last; `begin` and `dispose` forget it */
  let closed: Session | undefined
  let timer: unknown
  // writes go one after another: an id comes back before the next one
  let pending = Promise.resolve()

  const stopTimer = () => {
    if (timer === undefined) return
    stopInterval(timer)
    timer = undefined
  }

  const startTimer = (current: Session) => {
    timer = startInterval(() => {
      void write(current)
    }, deps.intervalMs ?? DIALOG_HISTORY_INTERVAL_MS)
  }

  const hasRecordings = (meta: EditorHistoryDialog) =>
    Boolean(meta.recordingFile || meta.recordingFiles?.length)

  const reportUnlinked = (target: Session) => {
    if (!hasRecordings(target.meta) || target.id || target.isUnlinkReported)
      return
    target.isUnlinkReported = true
    deps.onRecordingUnlinked?.()
  }

  const write = (target: Session): Promise<void> => {
    pending = pending.then(async () => {
      const text = deps.getText()
      if (!text.trim() && !hasRecordings(target.meta)) return
      const meta = target.meta
      if (text === target.savedText && meta === target.savedMeta) return
      try {
        const id = await deps.save({
          ...(target.id && { id: target.id }),
          text,
          kind: 'dialog',
          dialog: meta,
        })
        // nothing stored under a known id: the entry was deleted. The
        // history never brings it back itself, but the undo of the deletion
        // may, so the next checkpoint tries again
        if (id === null && target.id) return
        target.savedText = text
        target.savedMeta = meta
        if (id !== null) target.id = id
        else reportUnlinked(target)
      } catch (error) {
        deps.reportError(error)
        reportUnlinked(target)
      }
    })
    return pending
  }

  // closed at once, written after: a `begin` meanwhile keeps its own session
  const end = async () => {
    stopTimer()
    const ending = session
    session = undefined
    if (!ending) return pending
    closed = ending
    await write(ending)
  }

  return {
    async begin(meta) {
      const ending = end()
      closed = undefined
      const current: Session = { meta }
      session = current
      startTimer(current)
      await ending
      // the first write of a recorded session links its file at once
      await write(current)
    },
    resume() {
      if (session) return true
      if (!closed) return false
      session = closed
      closed = undefined
      startTimer(session)
      return true
    },
    async addRecording(file, options = {}) {
      if (!session) return
      const files = session.meta.recordingFiles
        ? [...session.meta.recordingFiles]
        : session.meta.recordingFile
          ? [session.meta.recordingFile]
          : []
      if (!files.includes(file)) files.push(file)
      session.meta = {
        ...session.meta,
        recordingFile: session.meta.recordingFile ?? file,
        recordingFiles: files,
        ...(options.isIncomplete && {
          incompleteRecordingFiles: withFile(
            session.meta.incompleteRecordingFiles,
            file
          ),
        }),
      }
      await write(session)
    },
    checkpoint: () => (session ? write(session) : pending),
    end,
    markRecordingIncomplete(file) {
      const current = session
      if (!current || !hasRecordings(current.meta)) return pending
      current.meta = {
        ...current.meta,
        incompleteRecordingFiles: withFile(
          current.meta.incompleteRecordingFiles,
          file
        ),
      }
      return write(current)
    },
    dispose() {
      stopTimer()
      session = undefined
      closed = undefined
    },
  }
}
