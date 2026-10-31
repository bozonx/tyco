import type { ChatMessage } from '@tyco/shared'

export interface ExportChatOptions {
  title?: string
}

/** The text as Markdown shows it, without its marks taking effect */
const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>#|]/g, '\\$&')

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
        const trimmed = attachment.text.trim()
        if (trimmed) {
          if (attachment.name)
            section.push(`**${escapeMarkdown(attachment.name)}**`)
          const quoted = trimmed
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
          section.push(quoted)
        }
      }
    }

    for (const image of message.images || []) {
      section.push(
        `[Image omitted: ${image.width} × ${image.height}, ${image.mediaType}]`
      )
    }

    const toolCalls = (message.parts || []).filter(
      (part) => part.type === 'tool-call'
    )
    if (toolCalls.length) {
      section.push(
        toolCalls
          .map((call) => `> Tool \`${call.toolName}\`: ${call.state}`)
          .join('\n')
      )
    }

    if (message.content?.trim()) {
      section.push(message.content.trim())
    }

    parts.push(section.join('\n\n'))
  }

  return parts.join('\n\n').trim()
}
