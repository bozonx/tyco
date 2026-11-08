import type { EditorHistoryFailure } from '@tyco/shared'

import { historyFailureOf } from '../history/history-failure'
import type { BufferedPendingAction } from '../modals/menu-modal-params'

export interface QuickInsertStepParams {
  text: string
  oldText: string
  isCorrectionUnchanged: boolean
}

export interface QuickInsertPendingOptions {
  allowBufferedIntent?: boolean
  direct?: boolean
}

export interface QuickInsertDependencies {
  correct: (text: string) => Promise<string>
  cancelCorrection: () => void
  saveOutput: (text: string) => Promise<unknown>
  saveDraft?: () => Promise<unknown>
  /** Keeps the typed text in the history before the model sees it */
  saveSource?: (text: string) => Promise<string | null>
  saveSourceResult?: (
    sourceId: string | null,
    result: string
  ) => Promise<unknown>
  /** Why the correction of the source `sourceId` produced nothing */
  saveSourceFailure?: (
    sourceId: string | null,
    failure: EditorHistoryFailure
  ) => Promise<unknown>
  /** The error text the user is shown, kept with a failed source */
  describeError?: (error: unknown) => string
  /** A failed history write; the submission goes on without it */
  reportHistoryError?: (error: unknown) => void
  insert: (text: string) => Promise<void>
  openStep?: (params: QuickInsertStepParams) => void
  setPending: (
    cancel: () => void,
    options?: QuickInsertPendingOptions
  ) => number | void
  clearPending: (owner?: number | void) => void
  isPending?: (owner: number | void) => boolean
  consumeBufferedIntent?: () => BufferedPendingAction | null
  executeBufferedIntent?: (
    intent: BufferedPendingAction,
    text: string,
    sourceText: string
  ) => Promise<boolean | void> | boolean | void
  reportError: (error: unknown) => void
  /** Whether the error means the correction was stopped, not that it failed */
  isAborted?: (error: unknown) => boolean
}

interface QuickInsertRun {
  owner?: number | void
  /** The history entry of the text before the correction */
  sourceId?: string | null
}

/** Owns a submission until insertion starts; abandoned results cannot paste. */
export function createQuickInsert(deps: QuickInsertDependencies) {
  let disposed = false
  let active: QuickInsertRun | null = null

  const cancel = () => {
    if (!active) return
    const owner = active.owner
    active = null
    deps.cancelCorrection()
    deps.clearPending(owner)
  }

  const saveSource = async (text: string): Promise<string | null> => {
    if (!deps.saveSource) return null
    try {
      return await deps.saveSource(text)
    } catch (error) {
      deps.reportHistoryError?.(error)
      return null
    }
  }

  const saveSourceResult = async (sourceId: string | null, result: string) => {
    if (!deps.saveSourceResult) return
    try {
      await deps.saveSourceResult(sourceId, result)
    } catch (error) {
      deps.reportHistoryError?.(error)
    }
  }

  /** Marks the source of `run` as failed, or cancelled when `run` is over */
  const saveFailure = async (run: QuickInsertRun, error?: unknown) => {
    if (!deps.saveSourceFailure || !run.sourceId) return
    const isCancelled =
      active !== run || (error !== undefined && !!deps.isAborted?.(error))
    const failure = historyFailureOf(
      error,
      error === undefined || isCancelled
        ? undefined
        : deps.describeError?.(error),
      isCancelled
    )
    try {
      await deps.saveSourceFailure(run.sourceId, failure)
    } catch (historyError) {
      deps.reportHistoryError?.(historyError)
    }
  }

  /** The history is a convenience: a failed write must not stop the insertion */
  const saveOutput = async (text: string) => {
    try {
      await deps.saveOutput(text)
    } catch (error) {
      deps.reportHistoryError?.(error)
    }
  }

  /**
   * The correction of `text`; the typed text reaches the history first, so a
   * failed request or a closed window does not lose it
   */
  const correctWithHistory = async (
    run: QuickInsertRun,
    text: string,
    customCorrect?: (text: string) => Promise<string>
  ): Promise<{ result: string; sourceId: string | null }> => {
    const sourceId = await saveSource(text)
    run.sourceId = sourceId
    const result = customCorrect
      ? await customCorrect(text)
      : await deps.correct(text)
    return { result, sourceId }
  }

  const start = async (
    text: string,
    customCorrect?: (text: string) => Promise<string>
  ): Promise<void> => {
    if (disposed || active || !text.trim()) return
    const run: QuickInsertRun = {}
    active = run
    run.owner = deps.setPending(cancel)
    try {
      const { result, sourceId } = await correctWithHistory(
        run,
        text,
        customCorrect
      )
      if (active !== run) {
        await saveFailure(run)
        return
      }
      if (!result.trim()) throw new Error('Correction returned empty text')
      if (result !== text) await saveSourceResult(sourceId, result)
      if (active !== run) {
        await saveFailure(run)
        return
      }
      await deps.insert(result)
      // recorded once it left the app; the write does not hold up the insertion
      void saveOutput(result)
    } catch (error) {
      if (active === run && !deps.isAborted?.(error)) deps.reportError(error)
      await saveFailure(run, error)
    } finally {
      if (active === run) {
        active = null
        deps.clearPending(run.owner)
      }
    }
  }

  /**
   * Opens the actions step with the correction of `text`; when the model cannot
   * correct it, the step opens with the text as typed, so the actions stay
   * reachable offline
   */
  const next = async (
    text: string,
    customCorrect?: (text: string) => Promise<string>
  ): Promise<void> => {
    if (disposed || active || !text.trim()) return
    const run: QuickInsertRun = {}
    active = run
    run.owner = deps.setPending(cancel, { allowBufferedIntent: true })
    let step: QuickInsertStepParams
    let succeeded = false
    try {
      const { result, sourceId } = await correctWithHistory(
        run,
        text,
        customCorrect
      )
      if (active !== run) {
        await saveFailure(run)
        return
      }
      if (!result.trim()) throw new Error('Correction returned empty text')
      if (result !== text) await saveSourceResult(sourceId, result)
      if (active !== run) {
        await saveFailure(run)
        return
      }
      succeeded = true
      step = {
        text: result,
        oldText: result === text ? '' : text,
        isCorrectionUnchanged: result === text,
      }
    } catch (error) {
      // a cancelled step stays closed; a failed one falls back to the input
      await saveFailure(run, error)
      if (active !== run) return
      if (!deps.isAborted?.(error)) deps.reportError(error)
      step = { text, oldText: '', isCorrectionUnchanged: false }
    }
    const showResult = deps.isPending?.(run.owner) ?? true
    const buffered =
      succeeded && showResult ? (deps.consumeBufferedIntent?.() ?? null) : null
    active = null
    deps.clearPending(run.owner)
    if (buffered && deps.executeBufferedIntent) {
      if (typeof buffered === 'object' && buffered !== null) {
        if (showResult) deps.openStep?.(step)
        await deps.executeBufferedIntent(buffered, step.text, text)
        return
      }
      const handled = await deps.executeBufferedIntent(
        buffered,
        step.text,
        text
      )
      if (handled !== false) return
    }
    if (showResult) deps.openStep?.(step)
  }

  const insertDirect = async (text: string): Promise<void> => {
    if (disposed || active || !text.trim()) return
    const run: QuickInsertRun = {}
    active = run
    run.owner = deps.setPending(cancel, { direct: true })
    try {
      try {
        await deps.saveDraft?.()
      } catch (error) {
        deps.reportHistoryError?.(error)
      }
      if (active !== run) return
      await deps.insert(text)
      void saveOutput(text)
    } catch (error) {
      if (active === run) deps.reportError(error)
    } finally {
      if (active === run) {
        active = null
        deps.clearPending(run.owner)
      }
    }
  }

  const dispose = () => {
    disposed = true
    cancel()
  }
  return { start, next, insertDirect, cancel, dispose }
}
