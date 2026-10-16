import type { ModelMessage } from '@bozonx/ai-kit'

type AssistantContent = Exclude<
  Extract<ModelMessage, { role: 'assistant' }>['content'],
  string
>
import type { ChatMessage, ChatMessagePart } from '@tyco/shared'

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool-result' }>

/** How long a tool's input or output may be when a step is retold as text */
const RETOLD_STEP_CHARACTERS = 300

const hasSteps = (message: ChatMessage) =>
  message.parts?.some((part) => part.type === 'tool-call') ?? false

/**
 * The answer's text in the order it was written. Parts carry it when there are
 * any; `content` is the whole answer otherwise
 */
function answerText(message: ChatMessage): string[] {
  const texts = (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
  return texts.length > 0 ? texts : [message.content]
}

/** A tool call the model is told about: it either ran or was refused */
function isSettled(call: ToolCallPart, results: Map<string, ToolResultPart>) {
  return call.state === 'denied' || results.has(call.toolCallId)
}

function resultOutput(call: ToolCallPart, result: ToolResultPart | undefined) {
  if (call.state === 'denied' || !result) {
    return { type: 'execution-denied' as const }
  }
  return result.isError
    ? { type: 'error-text' as const, value: result.output }
    : { type: 'text' as const, value: result.output }
}

/**
 * An answer that used tools, as the model has to see it again: its calls and
 * their results, round by round. A call that never finished — the answer was
 * stopped while it ran or waited for approval — is left out, since the model
 * cannot be shown a call without its result. Reasoning is not sent back
 */
function toolRounds(message: ChatMessage): ModelMessage[] {
  const parts = message.parts ?? []
  const results = new Map(
    parts
      .filter((part) => part.type === 'tool-result')
      .map((part) => [part.toolCallId, part])
  )
  const rounds: ModelMessage[] = []
  let assistant: AssistantContent = []
  let calls: ToolCallPart[] = []

  const flush = () => {
    if (assistant.length > 0)
      rounds.push({ role: 'assistant', content: assistant })
    if (calls.length > 0) {
      rounds.push({
        role: 'tool',
        content: calls.map((call) => ({
          type: 'tool-result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: resultOutput(call, results.get(call.toolCallId)),
        })),
      })
    }
    assistant = []
    calls = []
  }

  for (const part of parts) {
    if (part.type === 'text') {
      // text after a round of tool calls starts the next assistant turn
      if (calls.length > 0) flush()
      if (part.text) assistant.push({ type: 'text', text: part.text })
    } else if (part.type === 'tool-call' && isSettled(part, results)) {
      assistant.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      })
      calls.push(part)
    }
  }
  flush()
  const hasText = parts.some((part) => part.type === 'text')
  if (!hasText && message.content) {
    rounds.push({ role: 'assistant', content: message.content })
  }
  return rounds as ModelMessage[]
}

const clip = (text: string) =>
  text.length > RETOLD_STEP_CHARACTERS
    ? `${text.slice(0, RETOLD_STEP_CHARACTERS)}…`
    : text

/**
 * The same answer for a model that cannot call tools: each step retold in a
 * line before the text, so the conversation still makes sense to it
 */
function retoldSteps(message: ChatMessage): string {
  const parts = message.parts ?? []
  const lines = parts.flatMap((part) => {
    if (part.type !== 'tool-call') return []
    const result = parts.find(
      (item): item is ToolResultPart =>
        item.type === 'tool-result' && item.toolCallId === part.toolCallId
    )
    const input = clip(JSON.stringify(part.input ?? {}))
    const outcome =
      part.state === 'denied'
        ? 'denied'
        : result
          ? clip(result.isError ? `error: ${result.output}` : result.output)
          : 'not finished'
    return [`[${part.toolName}(${input}) → ${outcome}]`]
  })
  return [lines.join('\n'), answerText(message).join('\n\n')]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The model messages for one stored assistant message. Plain answers stay a
 * single text message; answers with tool steps keep them for a model that can
 * call tools and are retold as text for one that cannot
 */
export function assistantMessages(
  message: ChatMessage,
  text: string,
  canUseTools: boolean
): ModelMessage[] {
  if (!hasSteps(message)) return [{ role: 'assistant', content: text }]
  if (!canUseTools)
    return [{ role: 'assistant', content: retoldSteps(message) }]
  return toolRounds(message)
}
