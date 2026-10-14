import { ref } from 'vue'
import type {
  ChatMessage,
  ChatParams,
  ChatAttachment,
  ChatImage,
} from '@tyco/shared'
export function createChatState() {
  const messages = ref<ChatMessage[]>([])
  const currentChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const error = ref('')
  const isStopped = ref(false)
  const omitHistoryImages = ref(false)
  const trimmedTurnCount = ref(0)
  const lastFailedTurn = ref<{
    message: string
    attachments?: ChatAttachment[]
    images?: ChatImage[]
  } | null>(null)
  return {
    messages,
    currentChatParams,
    isGenerating,
    error,
    isStopped,
    omitHistoryImages,
    trimmedTurnCount,
    lastFailedTurn,
  }
}
export type ChatState = ReturnType<typeof createChatState>
