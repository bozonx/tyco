export interface QuickInsertDeps {
  correct: (text: string) => Promise<string>
  cancelCorrection: () => void
  saveOutput: (text: string) => Promise<unknown>
  insert: (text: string) => Promise<void>
  setPending: (cancel: () => void) => void
  clearPending: () => void
  reportError: (error: unknown) => void
}

/** Owns a submission until insertion starts; abandoned results cannot paste. */
export function createQuickInsert(deps: QuickInsertDeps) {
  let active: object | null = null

  const cancel = () => {
    if (!active) return
    active = null
    deps.cancelCorrection()
    deps.clearPending()
  }

  const start = async (text: string): Promise<void> => {
    if (active || !text.trim()) return
    const run = {}
    active = run
    deps.setPending(cancel)
    try {
      const result = await deps.correct(text)
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
        deps.clearPending()
      }
    }
  }

  return { start, cancel }
}
