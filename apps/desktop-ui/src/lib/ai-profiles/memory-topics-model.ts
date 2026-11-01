import { ref } from 'vue'
import type { ProfileMemoryTopic } from '@tyco/shared'

/** A refresh cannot restore topics after disabling memory or changing profile. */
export function createMemoryTopicsModel(deps: {
  list: (profileId: string) => Promise<ProfileMemoryTopic[]>
  clear: (profileId: string) => Promise<unknown>
  reportError: (error: unknown) => void
  onCleared: () => void
}) {
  const topics = ref<ProfileMemoryTopic[]>([])
  const isLoading = ref(false)
  const isClearing = ref(false)
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
  async function clearMemory(profileId: string) {
    if (isDisposed || isClearing.value) return
    reset()
    const request = revision
    isClearing.value = true
    try {
      await deps.clear(profileId)
      if (!isDisposed && request === revision) {
        deps.onCleared()
        await loadTopics(profileId)
      }
    } catch (error) {
      if (!isDisposed && request === revision) deps.reportError(error)
    } finally {
      isClearing.value = false
    }
  }
  function dispose() {
    isDisposed = true
    reset()
  }
  return {
    topics,
    isLoading,
    isClearing,
    reset,
    loadTopics,
    clearMemory,
    dispose,
  }
}
