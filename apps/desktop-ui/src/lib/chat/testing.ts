import type { ChatToolLoopState } from '../chat-tools/chat-tool-loop'

/** The answer state of a plain reply, as `sendChatMessage` resolves it */
export function chatAnswer(text: string): ChatToolLoopState {
  return { content: text, parts: text ? [{ type: 'text', text }] : [] }
}

const streamed = new WeakMap<object, string>()

/**
 * Streams one more piece of a plain reply into `options.onUpdate`, the way a
 * real turn reports its growing text. Resolves to the state so far
 */
export function streamChunk(
  options: { onUpdate?: (state: ChatToolLoopState) => void } | undefined,
  text: string
): ChatToolLoopState {
  if (!options) return chatAnswer(text)
  const content = (streamed.get(options) ?? '') + text
  streamed.set(options, content)
  const state = chatAnswer(content)
  options.onUpdate?.(state)
  return state
}
