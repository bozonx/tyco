import { ref } from 'vue'

/** A failed or cancelled flush never acknowledges a successful shutdown. */
export function createSettingsShutdown(deps: {
  flush: () => Promise<boolean>
  acknowledge: (requestId: number, saved: boolean) => Promise<void>
  notifyError: () => void
}) {
  const isClosing = ref(false)
  let activeRequest: number | undefined
  async function request(requestId: number) {
    activeRequest = requestId
    isClosing.value = true
    let saved: boolean
    try {
      saved = await deps.flush()
    } catch {
      saved = false
    }
    if (activeRequest !== requestId) return
    try {
      await deps.acknowledge(requestId, saved)
    } catch {
      if (activeRequest === requestId) cancel()
    }
  }
  function cancel() {
    activeRequest = undefined
    isClosing.value = false
    deps.notifyError()
  }
  function dispose() {
    activeRequest = undefined
    isClosing.value = false
  }
  return { isClosing, request, cancel, dispose }
}
