export interface SecretKeyEditorDependencies {
  getSecretId: () => string | undefined
  getDraft: () => string
  setDraft: (value: string) => void
  setSecret: (id: string, value: string, origins?: string[]) => Promise<void>
  removeSecret: (id: string) => Promise<void>
  reportError: (error: unknown) => void
  onSaved?: (value: string) => void
  onRemoved?: () => void
}

/** Saves only the submitted draft; edits made while saving remain visible. */
export function createSecretKeyEditor(deps: SecretKeyEditorDependencies) {
  const save = async (origins?: string[]) => {
    const id = deps.getSecretId()
    const draft = deps.getDraft()
    const value = draft.trim()
    if (!id || !value) return
    try {
      if (origins) await deps.setSecret(id, value, origins)
      else await deps.setSecret(id, value)
      if (deps.getSecretId() !== id) return
      deps.onSaved?.(value)
      if (deps.getDraft() === draft) deps.setDraft('')
    } catch (error) {
      deps.reportError(error)
    }
  }

  const remove = async () => {
    const id = deps.getSecretId()
    if (!id) return
    try {
      await deps.removeSecret(id)
      if (deps.getSecretId() === id) deps.onRemoved?.()
    } catch (error) {
      deps.reportError(error)
    }
  }

  return { save, remove }
}
