import type { ModelMessage } from '@bozonx/ai-kit'
import type { AiAttachedFile, ChatMessage } from '@tyco/shared'

import { conversationAttachedFiles } from '../chat/chat-attached-files'
import { formatAttachmentsForPrompt } from '../chat/chat-attachment'
import { assistantMessages } from './llm-prompt-steps'

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
  /**
   * Whether the model can call tools: earlier tool steps are then sent as calls
   * and results, and retold as text otherwise
   */
  canUseTools?: boolean
}

function messageContent(
  message: ChatMessage,
  files: readonly AiAttachedFile[]
): string {
  const attachments = formatAttachmentsForPrompt(message.attachments, files)

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

  // only a model with tools reaches the originals by their paths
  const files = options.canUseTools
    ? conversationAttachedFiles(
        conversation.flatMap((message) => message.attachments || [])
      )
    : []
  const messages = conversation
    .filter((message) => message.role !== 'developer')
    .flatMap((message): ModelMessage[] => {
      const text = messageContent(message, files)
      if (message.role === 'assistant') {
        return assistantMessages(message, text, options.canUseTools ?? false)
      }
      if (!message.images?.length) {
        return [{ role: 'user', content: text }]
      }
      return [
        {
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
        },
      ]
    })

  return system ? { system, messages } : { messages }
}
