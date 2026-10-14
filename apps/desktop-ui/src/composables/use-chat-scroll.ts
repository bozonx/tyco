import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createChatScroll } from '../lib/chat/chat-scroll'

export function useChatScroll(deps: {
  getChatId: () => string | undefined
  getStreamRevision: () => unknown
  clearInput: () => void
}) {
  const scroller = ref<HTMLElement | null>(null)
  const scroll = createChatScroll({
    getElement: () => scroller.value,
    getMotion: () => document.documentElement.dataset.motion,
    afterRender: nextTick,
  })
  watch(deps.getStreamRevision, scroll.handleContentResized)
  watch(deps.getChatId, () => {
    deps.clearInput()
    scroll.pinnedToBottom.value = true
    void scroll.scrollToBottom()
  })
  onBeforeUnmount(scroll.dispose)
  return { scroller, ...scroll }
}
