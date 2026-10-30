export interface QuickInsertStepParams {
  text: string
  oldText: string
  isCorrectionUnchanged: boolean
}

export interface QuickInsertDependencies {
  correct: (text: string) => Promise<string>
  cancelCorrection: () => void
  saveOutput: (text: string) => Promise<unknown>
  /** Keeps the typed text in the history before the model sees it */
  saveSource?: (text: string) => Promise<string | null>
  saveSourceResult?: (
    sourceId: string | null,
    result: string
  ) => Promise<unknown>
  /** A failed history write; the submission goes on without it */
  reportHistoryError?: (error: unknown) => void
  insert: (text: string) => Promise<void>
  openStep?: (params: QuickInsertStepParams) => void
  setPending: (cancel: () => void) => number | void
  clearPending: (owner?: number | void) => void
  reportError: (error: unknown) => void
}

/** Owns a submission until insertion starts; abandoned results cannot paste. */
export function createQuickInsert(deps: QuickInsertDependencies) {
  let disposed = false
  let active: { owner?: number | void } | null = null

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

  /**
   * The correction of `text`; the typed text reaches the history first, so a
   * failed request or a closed window does not lose it
   */
  const correctWithHistory = async (
    text: string,
    customCorrect?: (text: string) => Promise<string>
  ): Promise<{ result: string; sourceId: string | null }> => {
    const sourceId = await saveSource(text)
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
    const run: { owner?: number | void } = {}
    active = run
    run.owner = deps.setPending(cancel)
    try {
      const { result, sourceId } = await correctWithHistory(text, customCorrect)
      if (active !== run) return
      if (!result.trim()) throw new Error('Correction returned empty text')
      if (result !== text) await saveSourceResult(sourceId, result)
      if (active !== run) return
      await deps.saveOutput(result)
      if (active !== run) return
      await deps.insert(result)
    } catch (error) {
      if (active === run) deps.reportError(error)
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
    const run: { owner?: number | void } = {}
    active = run
    run.owner = deps.setPending(cancel)
    let step: QuickInsertStepParams
    try {
      const { result, sourceId } = await correctWithHistory(text, customCorrect)
      if (active !== run) return
      if (!result.trim()) throw new Error('Correction returned empty text')
      if (result !== text) await saveSourceResult(sourceId, result)
      if (active !== run) return
      step = {
        text: result,
        oldText: result === text ? '' : text,
        isCorrectionUnchanged: result === text,
      }
    } catch (error) {
      // a cancelled step stays closed; a failed one falls back to the input
      if (active !== run) return
      deps.reportError(error)
      step = { text, oldText: '', isCorrectionUnchanged: false }
    }
    active = null
    deps.clearPending(run.owner)
    deps.openStep?.(step)
  }

  const insertDirect = async (text: string): Promise<void> => {
    if (disposed || active || !text.trim()) return
    const run: { owner?: number | void } = {}
    active = run
    run.owner = deps.setPending(cancel)
    try {
      await deps.saveOutput(text)
      if (active !== run) return
      await deps.insert(text)
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
