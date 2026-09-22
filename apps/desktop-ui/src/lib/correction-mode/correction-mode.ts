export interface CorrectionModeDeps {
  startCorrection: (text: string) => Promise<void>
  setPending: (pending: boolean) => void
}

export function createCorrectionMode(deps: CorrectionModeDeps) {
  let lastText: string | null = null
  let pending = false

  const consume = async (text: string | null | undefined): Promise<void> => {
    if (!text?.trim()) {
      if (!pending) lastText = null
      return
    }
    if (text === lastText || pending) return

    lastText = text
    pending = true
    deps.setPending(true)
    try {
      await deps.startCorrection(text)
    } finally {
      pending = false
      deps.setPending(false)
    }
  }

  return { consume }
}
