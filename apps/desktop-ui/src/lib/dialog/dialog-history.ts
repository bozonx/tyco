import type {
  Dialog,
  DialogSegment as StoredDialogSegment,
  DialogSessionBreak as StoredDialogSessionBreak,
  DialogSource,
} from '@tyco/shared'

import type { DialogSegment, DialogSessionBreak } from './dialog-transcript'

/** How often a running dialog checkpoints to disk while it has new turns */
export const DIALOG_HISTORY_INTERVAL_MS = 15_000

export interface DialogHistorySnapshot {
  title: string
  translationTargetLanguage: string
  segments: readonly DialogSegment[]
  sessionBreaks: readonly DialogSessionBreak[]
}

export interface DialogHistoryDependencies {
  /** Saves the structured dialog to `dialogs/<id>.json` */
  save: (dialog: Dialog) => Promise<void>
  /** Current live state of the dialog; interim segments are excluded on save */
  getSnapshot: () => DialogHistorySnapshot
  reportError: (error: unknown) => void
  /**
   * The recording of the session got no saved dialog: the first write failed.
   * Called once a session.
   */
  onRecordingUnlinked?: () => void
  now?: () => number
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  intervalMs?: number
}

export interface DialogHistorySessionInit {
  id: string
  startedAt: number
  source: DialogSource
  recordingFiles?: string[]
  incompleteRecordingFiles?: string[]
}

export interface DialogHistory {
  /** Ends the previous session, if any, and opens a new one */
  begin: (session: DialogHistorySessionInit) => Promise<void>
  /** Attaches an existing saved dialog so resuming or retrying updates it */
  load: (dialog: Dialog) => void
  /** Reopens the session `end` closed so resuming continues under the same id */
  resume: () => boolean
  /** Adds another recording file to the current session */
  addRecording: (
    file: string,
    options?: { isIncomplete?: boolean }
  ) => Promise<void>
  /** Writes the session when its content changed since the last write */
  checkpoint: () => Promise<void>
  /** A last checkpoint; the session stays closed until `begin` or `resume` */
  end: () => Promise<void>
  /** Marks a recording as incomplete and checkpoints */
  markRecordingIncomplete: (file: string) => Promise<void>
  /** Forgets both the open and closed sessions (e.g. starting a new dialog) */
  reset: () => void
  dispose: () => void
}

interface Session {
  id: string
  startedAt: number
  source: DialogSource
  recordingFiles: string[]
  incompleteRecordingFiles: string[]
  savedFingerprint?: string
  isSaved: boolean
  isUnlinkReported?: boolean
}

function withFile(files: readonly string[], file: string): string[] {
  return files.includes(file) ? [...files] : [...files, file]
}

function toStoredSegments(
  segments: readonly DialogSegment[]
): StoredDialogSegment[] {
  return segments
    .filter((segment) => segment.isFinal)
    .map((segment) => ({
      id: segment.id,
      side: segment.side,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      ...(segment.translation !== undefined && {
        translation: segment.translation,
      }),
      translationState: segment.translationState,
    }))
}

function toStoredBreaks(
  breaks: readonly DialogSessionBreak[]
): StoredDialogSessionBreak[] {
  return breaks.map((item) => ({
    id: item.id,
    timestampMs: item.timestampMs,
    isRecording: item.isRecording,
    ...(item.recordingFile && { recordingFile: item.recordingFile }),
    ...(item.action && { action: item.action }),
  }))
}

function computePayloadFingerprint(payload: {
  id: string
  title: string
  startedAt: number
  source: DialogSource
  translationTargetLanguage: string
  segments: readonly StoredDialogSegment[]
  sessionBreaks: readonly StoredDialogSessionBreak[]
  recordingFiles: readonly string[]
  incompleteRecordingFiles: readonly string[]
}): string {
  return JSON.stringify({
    id: payload.id,
    title: payload.title,
    startedAt: payload.startedAt,
    updatedAt: 0,
    source: payload.source,
    translationTargetLanguage: payload.translationTargetLanguage,
    segments: payload.segments,
    sessionBreaks: payload.sessionBreaks,
    recordingFiles: payload.recordingFiles,
    incompleteRecordingFiles: payload.incompleteRecordingFiles,
  })
}

/**
 * Checkpoints a dialog session into `dialogs/<id>.json`. A session without
 * settled speech is saved only when it has a recording, so the recording stays
 * reachable.
 */
export function createDialogHistory(
  deps: DialogHistoryDependencies
): DialogHistory {
  const now = deps.now ?? (() => Date.now())
  const startInterval =
    deps.setInterval ??
    ((callback: () => void, ms: number) => globalThis.setInterval(callback, ms))
  const stopInterval =
    deps.clearInterval ??
    ((handle: unknown) =>
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>))
  let session: Session | undefined
  let closed: Session | undefined
  let timer: unknown
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

  const reportUnlinked = (target: Session) => {
    if (target.isSaved || target.isUnlinkReported) return
    if (target.recordingFiles.length === 0) return
    target.isUnlinkReported = true
    deps.onRecordingUnlinked?.()
  }

  const write = (target: Session | undefined): Promise<void> => {
    if (!target) return Promise.resolve()
    const snapshot = deps.getSnapshot()
    const segments = toStoredSegments(snapshot.segments)
    const sessionBreaks = toStoredBreaks(snapshot.sessionBreaks)
    const hasContent = segments.length > 0 || target.recordingFiles.length > 0
    if (!hasContent) return Promise.resolve()

    const payload: Dialog = {
      id: target.id,
      title: snapshot.title,
      startedAt: target.startedAt,
      updatedAt: now(),
      source: target.source,
      translationTargetLanguage: snapshot.translationTargetLanguage,
      segments,
      sessionBreaks,
      recordingFiles: [...target.recordingFiles],
      incompleteRecordingFiles: [...target.incompleteRecordingFiles],
    }
    const fingerprint = computePayloadFingerprint({
      id: target.id,
      title: snapshot.title,
      startedAt: target.startedAt,
      source: target.source,
      translationTargetLanguage: snapshot.translationTargetLanguage,
      segments,
      sessionBreaks,
      recordingFiles: target.recordingFiles,
      incompleteRecordingFiles: target.incompleteRecordingFiles,
    })
    if (target.savedFingerprint === fingerprint) return Promise.resolve()

    const run = pending.then(async () => {
      try {
        await deps.save(payload)
        target.isSaved = true
        target.savedFingerprint = fingerprint
      } catch (error) {
        deps.reportError(error)
        reportUnlinked(target)
      }
    })
    pending = run
    return run
  }

  return {
    async begin(init) {
      stopTimer()
      closed = undefined
      const previous = session
      const next: Session = {
        id: init.id,
        startedAt: init.startedAt,
        source: init.source,
        recordingFiles: [...(init.recordingFiles ?? [])],
        incompleteRecordingFiles: [...(init.incompleteRecordingFiles ?? [])],
        isSaved: false,
      }
      session = next
      await write(previous)
      if (session !== next) return
      startTimer(next)
      if (next.recordingFiles.length > 0) await write(next)
    },
    load(dialog) {
      stopTimer()
      session = undefined
      const recordingFiles = [...(dialog.recordingFiles ?? [])]
      const incompleteRecordingFiles = [
        ...(dialog.incompleteRecordingFiles ?? []),
      ]
      const fingerprint = computePayloadFingerprint({
        id: dialog.id,
        title: dialog.title,
        startedAt: dialog.startedAt,
        source: dialog.source,
        translationTargetLanguage: dialog.translationTargetLanguage,
        segments: toStoredSegments(
          dialog.segments.map((s) => ({ ...s, isFinal: true }))
        ),
        sessionBreaks: toStoredBreaks(dialog.sessionBreaks ?? []),
        recordingFiles,
        incompleteRecordingFiles,
      })
      closed = {
        id: dialog.id,
        startedAt: dialog.startedAt,
        source: dialog.source,
        recordingFiles,
        incompleteRecordingFiles,
        savedFingerprint: fingerprint,
        isSaved: true,
      }
    },
    resume() {
      if (session || !closed) return false
      session = closed
      closed = undefined
      startTimer(session)
      return true
    },
    async addRecording(file, options) {
      const target = session ?? closed
      if (!target) return
      target.recordingFiles = withFile(target.recordingFiles, file)
      if (options?.isIncomplete) {
        target.incompleteRecordingFiles = withFile(
          target.incompleteRecordingFiles,
          file
        )
      }
      await write(target)
    },
    checkpoint() {
      return write(session ?? closed)
    },
    async end() {
      stopTimer()
      const current = session
      session = undefined
      if (current) closed = current
      await write(current)
    },
    async markRecordingIncomplete(file) {
      const target = session ?? closed
      if (!target) return
      target.incompleteRecordingFiles = withFile(
        target.incompleteRecordingFiles,
        file
      )
      await write(target)
    },
    reset() {
      stopTimer()
      session = undefined
      closed = undefined
    },
    dispose() {
      stopTimer()
      session = undefined
      closed = undefined
    },
  }
}
