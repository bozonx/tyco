import { ref } from 'vue'

export interface MemoryCompactionDependencies {
  read: (profileId: string, file: string) => Promise<string>
  compact: (file: string, content: string) => Promise<string>
  write: (profileId: string, file: string, content: string) => Promise<unknown>
  reportError: (error: unknown) => void
  onUnchanged: () => void
  onApplied: (
    profileId: string,
    file: string,
    original: string,
    content: string
  ) => void
}

/** Prepares a diff and writes only the result the user explicitly accepts. */
export function createMemoryCompactionModel(
  deps: MemoryCompactionDependencies
) {
  const isCompacting = ref(false)
  const isApplying = ref(false)
  const isDiffModalOpen = ref(false)
  const compactingFile = ref('')
  const diffOldText = ref('')
  const diffNewText = ref('')
  let profileId = ''
  let revision = 0
  let isDisposed = false

  function closeDiffModal() {
    revision += 1
    isDiffModalOpen.value = false
    compactingFile.value = ''
    diffOldText.value = ''
    diffNewText.value = ''
  }
  async function startCompaction(
    id: string,
    file: string,
    editorContent?: string
  ) {
    if (isDisposed || isCompacting.value || isApplying.value) return
    closeDiffModal()
    const request = revision
    isCompacting.value = true
    try {
      const content = editorContent ?? (await deps.read(id, file))
      if (isDisposed || request !== revision) return
      const result = await deps.compact(file, content)
      if (isDisposed || request !== revision) return
      if (result.trim() === content.trim()) {
        deps.onUnchanged()
        return
      }
      profileId = id
      compactingFile.value = file
      diffOldText.value = content
      diffNewText.value = result
      isDiffModalOpen.value = true
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    } finally {
      isCompacting.value = false
    }
  }
  async function applyCompaction() {
    if (isDisposed || !isDiffModalOpen.value || isApplying.value) return
    const request = revision
    const id = profileId
    const file = compactingFile.value
    const original = diffOldText.value
    const content = diffNewText.value
    isApplying.value = true
    try {
      await deps.write(id, file, content)
      if (!isDisposed && request === revision) {
        closeDiffModal()
        deps.onApplied(id, file, original, content)
      }
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    } finally {
      isApplying.value = false
    }
  }
  function dispose() {
    isDisposed = true
    closeDiffModal()
  }
  return {
    isCompacting,
    isApplying,
    isDiffModalOpen,
    compactingFile,
    diffOldText,
    diffNewText,
    startCompaction,
    closeDiffModal,
    applyCompaction,
    dispose,
  }
}
