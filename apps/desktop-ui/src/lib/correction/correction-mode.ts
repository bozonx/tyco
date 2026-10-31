export interface CorrectionModeDependencies {
  startCorrection: (text: string) => Promise<void>
  setPending: (pending: boolean) => void
}

export function createCorrectionMode(deps: CorrectionModeDependencies) {
  let lastText: string | null = null
  let pending = false
  let queuedText: string | null = null
  let currentActivationId: number | undefined
  let generation = 0
  let disposed = false

  const consume = async (
    text: string | null | undefined,
    activationId = 0
  ): Promise<void> => {
    if (disposed) return
    if (activationId !== currentActivationId) {
      currentActivationId = activationId
      generation += 1
      lastText = null
      queuedText = null
      // the run of the old activation will not clear its pending state
      if (pending) {
        pending = false
        deps.setPending(false)
      }
    }
    if (!text?.trim()) {
      lastText = null
      queuedText = null
      return
    }
    if (text === lastText) return
    if (pending) {
      queuedText = text
      return
    }

    const runGeneration = generation
    lastText = text
    pending = true
    deps.setPending(true)
    try {
      await deps.startCorrection(text)
    } finally {
      if (runGeneration === generation && !disposed) {
        pending = false
        deps.setPending(false)
        const nextText = queuedText
        queuedText = null
        if (nextText) await consume(nextText, activationId)
      }
    }
  }

  return {
    consume,
    dispose: () => {
      disposed = true
      generation += 1
      queuedText = null
    },
  }
}
