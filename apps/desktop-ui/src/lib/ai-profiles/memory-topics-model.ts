import { ref } from 'vue'
import type { ProfileMemoryTopic } from '@tyco/shared'

/** A refresh cannot restore topics after disabling memory or changing profile. */
export function createMemoryTopicsModel(deps: {
  list: (profileId: string) => Promise<ProfileMemoryTopic[]>
  deleteFile: (profileId: string, file: string) => Promise<unknown>
  reportError: (error: unknown) => void
  onDeleted: (file: string) => void
}) {
  const topics = ref<ProfileMemoryTopic[]>([])
  const isLoading = ref(false)
  const isDeleting = ref(false)
  let revision = 0
  let isDisposed = false
  function reset() {
    revision += 1
    topics.value = []
    isLoading.value = false
  }
  async function loadTopics(profileId: string) {
    if (isDisposed) return
    const request = ++revision
    isLoading.value = true
    try {
      const result = await deps.list(profileId)
      if (!isDisposed && request === revision) topics.value = result
    } catch (error) {
      if (!isDisposed && request === revision) {
        topics.value = []
        deps.reportError(error)
      }
    } finally {
      if (request === revision) isLoading.value = false
    }
  }
  /** Deletes one file, then lists the files again */
  async function deleteFile(profileId: string, file: string) {
    if (isDisposed || isDeleting.value) return
    const request = revision
    isDeleting.value = true
    try {
      await deps.deleteFile(profileId, file)
      if (!isDisposed && request === revision) {
        deps.onDeleted(file)
        await loadTopics(profileId)
      }
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    } finally {
      isDeleting.value = false
    }
  }
  function dispose() {
    isDisposed = true
    reset()
  }
  return {
    topics,
    isLoading,
    isDeleting,
    reset,
    loadTopics,
    deleteFile,
    dispose,
  }
}
