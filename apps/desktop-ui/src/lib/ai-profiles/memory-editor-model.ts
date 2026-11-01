import { ref } from 'vue'

export interface MemoryEditorDependencies {
  read: (profileId: string, file: string) => Promise<string>
  write: (profileId: string, file: string, content: string) => Promise<unknown>
  reportError: (error: unknown) => void
  onSaved: () => void
}

/** A file and its text are published together; only the latest open may win. */
export function createMemoryEditorModel(deps: MemoryEditorDependencies) {
  const isEditorOpen = ref(false)
  const editingFile = ref('')
  const editorContent = ref('')
  const isSaving = ref(false)
  let revision = 0
  let profileId = ''
  let isDisposed = false

  function closeEditor() {
    revision += 1
    isEditorOpen.value = false
    editingFile.value = ''
    editorContent.value = ''
  }
  async function openEditor(id: string, file: string) {
    if (isDisposed || isSaving.value) return
    closeEditor()
    const request = revision
    try {
      const content = await deps.read(id, file)
      if (isDisposed || request !== revision) return
      profileId = id
      editingFile.value = file
      editorContent.value = content
      isEditorOpen.value = true
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    }
  }
  async function saveEditor() {
    if (isDisposed || !isEditorOpen.value || isSaving.value) return
    const request = revision
    const file = editingFile.value
    const content = editorContent.value
    isSaving.value = true
    try {
      await deps.write(profileId, file, content)
      if (!isDisposed && request === revision) {
        // A user may keep typing while the write is running.
        if (editorContent.value === content) closeEditor()
        deps.onSaved()
      }
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    } finally {
      isSaving.value = false
    }
  }
  function replaceContent(
    id: string,
    file: string,
    original: string,
    content: string
  ) {
    if (
      isEditorOpen.value &&
      profileId === id &&
      editingFile.value === file &&
      editorContent.value === original
    ) {
      editorContent.value = content
    }
  }
  function dispose() {
    isDisposed = true
    closeEditor()
  }
  return {
    isEditorOpen,
    editingFile,
    editorContent,
    isSaving,
    openEditor,
    closeEditor,
    saveEditor,
    replaceContent,
    dispose,
  }
}
