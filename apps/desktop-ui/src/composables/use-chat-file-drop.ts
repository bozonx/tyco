import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createChatFileDropListener } from '../lib/chat/chat-file-drop-listener'
import { getDesktopWebview } from '../lib/desktop/window'
import { clientLogger } from '../lib/logger'

export function useChatFileDrop(deps: {
  getContext: () => unknown
  canAccept: () => boolean
  accept: (paths: string[]) => Promise<void>
}) {
  const dropZoneRef = ref<HTMLElement | null>(null)
  const draggingFiles = ref(false)
  const listener = createChatFileDropListener({
    ...deps,
    getBounds: () => dropZoneRef.value?.getBoundingClientRect() ?? null,
    getScale: () => window.devicePixelRatio,
    setDragging: (value) => {
      draggingFiles.value = value
    },
    subscribe: (handler) =>
      getDesktopWebview().onDragDropEvent(({ payload }) => handler(payload)),
    reportError: (message, error) => clientLogger.error(message, error, 'chat'),
  })
  watch(deps.getContext, () => {
    draggingFiles.value = false
  })
  onMounted(() => {
    void listener.start()
  })
  onBeforeUnmount(listener.dispose)
  return { dropZoneRef, draggingFiles }
}
