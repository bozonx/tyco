import type { ModelMessage } from '@bozonx/ai-kit'
import type { ChatMessage } from '@tyco/shared'

import { formatAttachmentsForPrompt } from '../chat/chat-attachment'

export interface LlmPrompt {
  system?: string
  messages: ModelMessage[]
}

export interface LlmPromptOptions {
  /** The app's instructions for the task */
  instructions?: string
  /** The user's own rules, placed after the instructions */
  rules?: string
  /** Heading the rules are introduced with */
  rulePrefix: string
  imageBytes?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
}

function messageContent(message: ChatMessage): string {
  const attachments = formatAttachmentsForPrompt(message.attachments)

  return [attachments, message.content].filter(Boolean).join('\n\n').trim()
}

/**
 * Instructions and rules go to the system prompt; the text to work on, or the
 * conversation, stays in the messages, so the task's "the last user message"
 * still points at it
 */
export function buildLlmPrompt(
  input: string | ChatMessage[],
  options: LlmPromptOptions
): LlmPrompt {
  const conversation: ChatMessage[] =
    typeof input === 'string' ? [{ role: 'user', content: input }] : input

  const system = [
    options.instructions?.trim(),
    options.rules?.trim() &&
      `${options.rulePrefix}:\n\n${options.rules.trim()}`,
    ...conversation
      .filter((message) => message.role === 'developer')
      .map((message) => message.content.trim()),
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages = conversation
    .filter((message) => message.role !== 'developer')
    .map((message): ModelMessage => {
      const text = messageContent(message)
      if (message.role !== 'user' || !message.images?.length) {
        return { role: message.role as 'user' | 'assistant', content: text }
      }
      return {
        role: 'user',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...message.images.map((image) => {
            const bytes = options.imageBytes?.get(image.id)
            if (!bytes) throw new Error('Chat image is unavailable')
            return {
              type: 'file' as const,
              data: bytes,
              mediaType: image.mediaType,
            }
          }),
        ],
      }
    })

  return system ? { system, messages } : { messages }
}

/** Fills `{{KEY}}` placeholders of an instruction template */
export function fillTemplate(
  template: string,
  values: Record<string, string> = {}
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template
  )
}
