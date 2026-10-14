import type { ChatAttachment, ChatMessage } from '@tyco/shared'
import { formatAttachmentsForPrompt } from './chat-attachment'

export interface PreparedChatRequest {
  userMessage: ChatMessage
  promptText: string
}

export function prepareChatRequest(
  message: string,
  attachments: ChatAttachment[] = []
): PreparedChatRequest {
  const attachmentPromptText = formatAttachmentsForPrompt(attachments)

  return {
    userMessage: {
      role: 'user',
      content: message,
      ...(attachments.length
        ? { attachments: attachments.map((item) => ({ ...item })) }
        : {}),
    },
    promptText: [attachmentPromptText, message].filter(Boolean).join('\n\n'),
  }
}
