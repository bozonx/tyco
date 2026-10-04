import type { ChatMessage } from '@tyco/shared'

const DRAFT_TITLE_LENGTH = 60
const TITLE_MAX_LENGTH = 80

/** The start of the first message, on one line, cut at a word */
export function draftChatTitle(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim()
  if (line.length <= DRAFT_TITLE_LENGTH) return line

  const cut = line.slice(0, DRAFT_TITLE_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  const head =
    lastSpace > DRAFT_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut
  return `${head.replace(/[\s,.;:!?-]+$/, '')}…`
}

/**
 * A title is generated once, after the first answer, and only while the chat
 * still has its draft title: the user may have renamed it meanwhile
 */
export function needsGeneratedTitle(
  messages: ChatMessage[],
  title: string
): boolean {
  const users = messages.filter((message) => message.role === 'user')
  const answers = messages.filter(
    (message) => message.role === 'assistant' && message.content
  )
  return (
    users.length === 1 &&
    answers.length === 1 &&
    title === draftChatTitle(users[0].content)
  )
}

/** What the model answered, as a title: one line, no quotes, no final dot */
export function cleanGeneratedTitle(raw: string): string {
  const line =
    raw
      .split('\n')
      .map((item) => item.trim())
      .find(Boolean) ?? ''
  const title = line
    .replace(/^(title|название)\s*:\s*/i, '')
    .replace(/^[#*\s]+|[*\s]+$/g, '')
    .replace(/^["'«“„`]+|["'»”“`]+$/g, '')
    .replace(/[.。]+$/, '')
    .trim()
  return title.length > TITLE_MAX_LENGTH
    ? `${title.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`
    : title
}

export const CHAT_TITLE_INSTRUCTIONS = [
  'Write a short title, 3 to 6 words, for the conversation below.',
  "Use the language of the user's message.",
  'Reply with the title only: no quotes, no trailing punctuation.',
].join(' ')

/** The conversation as one text for the title request, kept short */
export function chatTitleSource(question: string, answer: string): string {
  return [
    `User: ${question.slice(0, 2_000)}`,
    `Assistant: ${answer.slice(0, 1_000)}`,
  ].join('\n\n')
}
