import type { ChatMessage, ChatMessagePart } from '@tyco/shared'
import { imageBudgetCharacters } from './chat-image-input'

/** What an old tool result is replaced with when the context runs short */
export const OMITTED_TOOL_RESULT = '[Result omitted to save context]'

/** The characters a step adds to the prompt; text is counted in `content` */
function partCharacters(part: ChatMessagePart): number {
  if (part.type === 'tool-call') {
    return part.toolName.length + JSON.stringify(part.input ?? {}).length
  }
  if (part.type === 'tool-result') return part.output.length
  return 0
}

function messageCharacters(message: ChatMessage): number {
  return (
    message.content.length +
    (message.attachments || []).reduce((n, a) => n + a.text.length, 0) +
    (message.images || []).reduce(
      (total, image) => total + imageBudgetCharacters(image),
      0
    ) +
    (message.parts || []).reduce((n, part) => n + partCharacters(part), 0)
  )
}

const hasToolResults = (message: ChatMessage) =>
  message.parts?.some(
    (part) => part.type === 'tool-result' && part.output !== OMITTED_TOOL_RESULT
  ) ?? false

/** The message with its tool results replaced by a note; the calls stay */
function withoutToolResults(message: ChatMessage): ChatMessage {
  if (!hasToolResults(message)) return message
  return {
    ...message,
    parts: message.parts!.map((part) =>
      part.type === 'tool-result'
        ? { ...part, output: OMITTED_TOOL_RESULT, isTruncated: undefined }
        : part
    ),
  }
}

/**
 * Keeps complete recent turns within a conservative character budget. Old tool
 * results go first: their bodies are replaced by a note, oldest turn first,
 * before any turn is dropped
 */
export function trimChatContext(
  messages: ChatMessage[],
  maxCharacters: number,
  maxImageCount = Number.POSITIVE_INFINITY
): ChatMessage[] {
  const turns: ChatMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message])
    else turns.at(-1)!.push(message)
  }

  const turnSize = (turn: ChatMessage[]) =>
    turn.reduce((sum, item) => sum + messageCharacters(item), 0)
  let total = turns.reduce((sum, turn) => sum + turnSize(turn), 0)
  for (
    let index = 0;
    index < turns.length && total > maxCharacters;
    index += 1
  ) {
    if (!turns[index].some(hasToolResults)) continue
    const before = turnSize(turns[index])
    turns[index] = turns[index].map(withoutToolResults)
    total -= before - turnSize(turns[index])
  }

  const selected: ChatMessage[][] = []
  let used = 0
  let imageCount = 0
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const size = turnSize(turn)
    const images = turn.reduce(
      (sum, item) => sum + (item.images?.length || 0),
      0
    )
    if (used + size > maxCharacters || imageCount + images > maxImageCount)
      break
    selected.unshift(turn)
    used += size
    imageCount += images
  }
  return selected.flat()
}
