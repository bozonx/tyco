/** A single-use draft passed to the activation that replaces its recording. */
export function createDictationHandoff() {
  let pending:
    { text: string; mode: 'voice' | 'listen'; activationId: number } | undefined
  return {
    set(text: string, mode: 'voice' | 'listen', activationId: number) {
      pending = { text, mode, activationId }
    },
    take(mode: 'voice' | 'listen', activationId: number): string {
      const draft = pending
      pending = undefined
      return draft?.mode === mode && draft.activationId === activationId
        ? draft.text
        : ''
    },
    clear() {
      pending = undefined
    },
  }
}
