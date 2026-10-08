import type { ChatMessage } from '@tyco/shared'

export interface ExportChatOptions {
  title?: string
}

/** Formats a chat dialogue into a clean Markdown string. */
export function formatChatToMarkdown(
  messages: ChatMessage[],
  options?: ExportChatOptions
): string {
  const parts: string[] = []
  const title = options?.title?.trim()
  if (title) {
    parts.push(`# ${title}`)
  }

  for (const message of messages) {
    const isUser = message.role === 'user'
    const roleHeader = isUser ? '### User' : '### Assistant'
    const section: string[] = [roleHeader]

    if (message.attachments?.length) {
      for (const attachment of message.attachments) {
        const trimmed = attachment.trim()
        if (trimmed) {
          const quoted = trimmed
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
          section.push(quoted)
        }
      }
    }

    if (message.content?.trim()) {
      section.push(message.content.trim())
    }

    parts.push(section.join('\n\n'))
  }

  return parts.join('\n\n').trim()
}
