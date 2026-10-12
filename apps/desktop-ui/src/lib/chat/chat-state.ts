import { ref } from 'vue'
import type {
  ChatMessage,
  ChatParams,
  ChatAttachment,
  ChatImage,
} from '@tyco/shared'
export function createChatState() {
  const messages = ref<ChatMessage[]>([])
  const newChatParams = ref<ChatParams>({})
  const isGenerating = ref(false)
  const error = ref('')
  const isStopped = ref(false)
  const omitHistoryImages = ref(false)
  const trimmedTurns = ref(0)
  /** The editor text the user removed from the current chat */
  const dismissedEditorContext = ref<string | null>(null)
  /** The suggested editor text the user took into the next message */
  const acceptedEditorContext = ref<string | null>(null)
  const lastFailedTurn = ref<{
    message: string
    attachments?: ChatAttachment[]
    images?: ChatImage[]
  } | null>(null)
  return {
    messages,
    newChatParams,
    isGenerating,
    error,
    isStopped,
    omitHistoryImages,
    trimmedTurns,
    dismissedEditorContext,
    acceptedEditorContext,
    lastFailedTurn,
  }
}
export type ChatState = ReturnType<typeof createChatState>
