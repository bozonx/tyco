import type { ChatMessage } from '@tyco/shared'

/** The draft title, cut from the first message */
const DRAFT_TITLE_LENGTH = 60
/**
 * A generated title is cut at this length; a title the user types may be
 * longer, up to `MAX_CHAT_TITLE_LENGTH` in `ChatSidebar.vue`
 */
const TITLE_MAX_LENGTH = 80
/**
 * A "Title:" a model may put before the title, in the languages of the app; the
 * title follows the language of the user's message
 */
const TITLE_LABEL = new RegExp(
  `^(${[
    'title',
    'название',
    'заголовок',
    'назва',
    'тақырып',
    'titel',
    'titre',
    'título',
    'titolo',
    'tytuł',
    'název',
    'titlu',
    'naslov',
    'cím',
    'başlık',
    'τίτλος',
    'სათაური',
    'タイトル',
    '제목',
    '标题',
    '標題',
  ].join('|')})\\s*[:：]\\s*`,
  'iu'
)

/** Favor the user's topic over the answer when bounding title generation input. */
const TITLE_QUESTION_CHARACTERS = 2_000
const TITLE_ANSWER_CHARACTERS = 1_000

/**
 * The first `length` characters of `text`. Counts code points, so an emoji or
 * another character outside the BMP is never cut in half
 */
function headOf(text: string, length: number): string {
  return Array.from(text).slice(0, length).join('')
}

function lengthOf(text: string): number {
  return Array.from(text).length
}

/** The start of the first message, on one line, cut at a word */
export function draftChatTitle(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim()
  if (lengthOf(line) <= DRAFT_TITLE_LENGTH) return line

  const cut = headOf(line, DRAFT_TITLE_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  const head =
    lastSpace > DRAFT_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut
  return `${head.replace(/[\s,.;:!?-]+$/, '')}…`
}

/**
 * The title a chat gets with its first question: its text, else the name of its
 * first attachment, else `fallback` (a question of images only)
 */
export function draftTitleOf(
  question: Pick<ChatMessage, 'content' | 'attachments'>,
  fallback: string
): string {
  return question.content.trim()
    ? draftChatTitle(question.content)
    : question.attachments?.[0]?.name || fallback
}

/**
 * A title is generated once, after the first answer, and only while the chat
 * still has its draft title: the user may have renamed it meanwhile
 */
export function needsGeneratedTitle(
  messages: ChatMessage[],
  title: string,
  fallbackTitle: string
): boolean {
  const users = messages.filter((message) => message.role === 'user')
  const answers = messages.filter(
    (message) => message.role === 'assistant' && message.content
  )
  return (
    users.length === 1 &&
    answers.length === 1 &&
    title === draftTitleOf(users[0], fallbackTitle)
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
    .replace(TITLE_LABEL, '')
    .replace(/^[#*\s]+|[*\s]+$/g, '')
    .replace(/^["'«“„`]+|["'»”“`]+$/g, '')
    .replace(/[.。]+$/, '')
    .trim()
  return lengthOf(title) > TITLE_MAX_LENGTH
    ? `${headOf(title, TITLE_MAX_LENGTH).trimEnd()}…`
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
    `User: ${question.slice(0, TITLE_QUESTION_CHARACTERS)}`,
    `Assistant: ${answer.slice(0, TITLE_ANSWER_CHARACTERS)}`,
  ].join('\n\n')
}
