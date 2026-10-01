import {
  type SelectionAction,
  type SelectionFinishStatus,
  type SelectionRunEvent,
  type StatusOverlayRequest,
  type UserConfig,
  parseSelectionAction,
} from '@tyco/shared'

/** Quick work finishes before the bubble would show up, so nothing flashes */
export const PENDING_OVERLAY_DELAY_MS = 400
const SUCCESS_HIDE_MS = 900
const INFO_HIDE_MS = 1800
const NOTICE_HIDE_MS = 4000
const ERROR_HIDE_MS = 6000

export interface SelectionReplaceDeps {
  /** Transforms the text; rejects on failure */
  run: (
    action: SelectionAction,
    text: string,
    signal: AbortSignal
  ) => Promise<string>
  /** Pastes `text` over the selection; null gives the clipboard back */
  finish: (runId: number, text: string | null) => Promise<SelectionFinishStatus>
  showOverlay: (request: StatusOverlayRequest | null) => void
  notify: (summary: string, body: string) => void
  saveResult?: (
    action: SelectionAction,
    text: string,
    result: string
  ) => Promise<void>
  /** The run brings the current config: this window misses its changes */
  applyUserConfig?: (userConfig: UserConfig) => void
  t: (key: string) => string
  describeError: (error: unknown) => string
  /** Whether the error means the request was aborted */
  isAborted?: (error: unknown) => boolean
}

/**
 * Keeps the whitespace around the selection: models drop a trailing newline,
 * and pasting would then remove it from the document
 */
export function keepSurroundingWhitespace(
  original: string,
  result: string
): string {
  const leading = /^\s*/.exec(original)?.[0] ?? ''
  const trailing = /\s*$/.exec(original)?.[0] ?? ''
  return `${leading}${result.trim()}${trailing}`
}

/**
 * Runs an action on the selection captured by the backend and hands the result
 * back for pasting. Nothing is shown while it is quick; a bubble tells what is
 * going on once it takes longer, and failures also go to desktop notifications
 */
export function createSelectionReplace(deps: SelectionReplaceDeps) {
  let active: { runId: number; controller: AbortController } | null = null

  const finishQuietly = async (runId: number) => {
    try {
      await deps.finish(runId, null)
    } catch {
      // nothing was going to be inserted anyway
    }
  }

  const fail = (action: SelectionAction | null, message: string) => {
    deps.showOverlay({
      kind: 'error',
      text: message,
      hideAfterMs: ERROR_HIDE_MS,
    })
    deps.notify(
      deps.t(`selection.failed.${action?.kind ?? 'correction'}`),
      message
    )
  }

  const notice = (text: string, hideAfterMs = INFO_HIDE_MS) => {
    deps.showOverlay({ kind: 'info', text, hideAfterMs })
  }

  const reportCaptureError = (
    action: SelectionAction | null,
    error: NonNullable<SelectionRunEvent['error']>
  ) => {
    switch (error.code) {
      case 'noSelection':
        notice(deps.t('selection.noSelection'))
        return
      case 'noTarget':
        notice(deps.t('selection.noTarget'), NOTICE_HIDE_MS)
        return
      default:
        fail(action, error.message)
    }
  }

  const handleRun = async (event: SelectionRunEvent): Promise<void> => {
    deps.applyUserConfig?.(event.userConfig)
    const action = parseSelectionAction(event.action)
    if (event.error) {
      reportCaptureError(action, event.error)
      return
    }
    if (!action || event.text === undefined) {
      await finishQuietly(event.runId)
      return
    }

    active?.controller.abort()
    const controller = new AbortController()
    const run = { runId: event.runId, controller }
    active = run
    const isCurrent = () => active === run && !controller.signal.aborted

    deps.showOverlay({
      kind: 'pending',
      text: deps.t(`selection.working.${action.kind}`),
      delayMs: PENDING_OVERLAY_DELAY_MS,
    })

    let result: string
    try {
      result = await deps.run(action, event.text, controller.signal)
    } catch (error) {
      if (!isCurrent() || deps.isAborted?.(error)) return
      active = null
      await finishQuietly(event.runId)
      fail(action, deps.describeError(error))
      return
    }
    // a request layer may resolve with a partial text on abort
    if (!isCurrent()) return
    active = null

    if (!result.trim()) {
      await finishQuietly(event.runId)
      fail(action, deps.t('selection.emptyResult'))
      return
    }
    if (result.trim() === event.text.trim()) {
      await finishQuietly(event.runId)
      notice(deps.t(`selection.unchanged.${action.kind}`))
      return
    }

    const replacement = keepSurroundingWhitespace(event.text, result)
    let status: SelectionFinishStatus
    try {
      status = await deps.finish(event.runId, replacement)
    } catch (error) {
      fail(action, deps.describeError(error))
      return
    }
    if (status === 'stale') return
    void deps.saveResult?.(action, event.text, replacement)

    if (status === 'clipboard') {
      const message = deps.t('selection.focusChanged')
      notice(message, NOTICE_HIDE_MS)
      deps.notify(deps.t('selection.resultInClipboard'), message)
      return
    }
    deps.showOverlay({
      kind: 'success',
      text: deps.t('selection.done'),
      hideAfterMs: SUCCESS_HIDE_MS,
      onlyIfVisible: true,
    })
  }

  /** The hotkey was pressed again while the run was in progress. */
  const handleCancel = (runId: number) => {
    if (active?.runId === runId) {
      active.controller.abort()
      active = null
    }
    notice(deps.t('selection.cancelled'))
  }

  return { handleRun, handleCancel }
}
