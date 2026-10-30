export interface QuickInsertDependencies {
  correct: (text: string) => Promise<string>
  cancelCorrection: () => void
  saveOutput: (text: string) => Promise<unknown>
  insert: (text: string) => Promise<void>
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

  const start = async (
    text: string,
    customCorrect?: (text: string) => Promise<string>
  ): Promise<void> => {
    if (disposed || active || !text.trim()) return
    const run: { owner?: number | void } = {}
    active = run
    run.owner = deps.setPending(cancel)
    try {
      const result = customCorrect
        ? await customCorrect(text)
        : await deps.correct(text)
      if (active !== run) return
      if (!result.trim()) throw new Error('Correction returned empty text')
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
  return { start, insertDirect, cancel, dispose }
}
