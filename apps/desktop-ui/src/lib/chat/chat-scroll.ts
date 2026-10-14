import { ref } from 'vue'
import { resolveScrollBehavior } from '../ui/scroll-behavior'

export interface ChatScrollElement {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  scrollTo: (options: ScrollToOptions) => void
}

/** Follows streamed content while preserving the reader's scroll position. */
export function createChatScroll(deps: {
  getElement: () => ChatScrollElement | null
  getMotion: () => string | undefined
  afterRender: () => Promise<void>
}) {
  const pinnedToBottom = ref(true)
  const showScrollButton = ref(false)
  let disposed = false

  function handleScroll() {
    const element = deps.getElement()
    if (!element || disposed) return
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight
    pinnedToBottom.value = distance < 80
    showScrollButton.value = distance > 160
  }

  async function scrollToBottom(behavior: 'instant' | 'smooth' = 'instant') {
    await deps.afterRender()
    const element = deps.getElement()
    if (!element || disposed) return
    element.scrollTo({
      top: Math.round(Math.max(0, element.scrollHeight - element.clientHeight)),
      behavior: resolveScrollBehavior(behavior, deps.getMotion()),
    })
  }

  function handleContentResized() {
    if (pinnedToBottom.value && !disposed) void scrollToBottom()
  }

  return {
    pinnedToBottom,
    showScrollButton,
    handleScroll,
    scrollToBottom,
    handleContentResized,
    dispose: () => {
      disposed = true
    },
  }
}
