import {
  toolApprovalResponse,
  type ModelMessage,
  type PrepareStep,
} from '@bozonx/ai-kit'
import type { ChatMessagePart, ChatToolCallState } from '@tyco/shared'

import {
  LlmError,
  type LlmStreamEvent,
  type LlmStreamOptions,
} from '../llm/llm-client'
import type { LlmPrompt } from '../llm/llm-prompt'
import { normalizeToolOutput } from './chat-tool-output'
import type { ChatToolDecision, ChatToolPolicy } from './chat-tool-policy'
import type { ChatToolSet } from './chat-tool-registry'

/** A call the model made that waits for the user */
export interface ChatToolApprovalRequest {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
}

/** Told to the model about a call the user refused */
const DENIED_REASON = 'The user did not allow this tool call.'

export interface ChatToolLoopDependencies {
  /** One streamed call on the chat's model */
  stream: (
    prompt: LlmPrompt,
    options: LlmStreamOptions
  ) => AsyncIterable<LlmStreamEvent>
  /**
   * Asks the user about a call. Without anybody to ask — a chat run through the
   * external API — it answers `deny` at once
   */
  requestApproval: (
    request: ChatToolApprovalRequest,
    signal: AbortSignal
  ) => Promise<ChatToolDecision>
  policy: ChatToolPolicy
}

export interface ChatToolLoopInput {
  prompt: LlmPrompt
  /** Null for a turn without tools: the loop is then one plain call */
  tools: ChatToolSet | null
  /** Model steps the whole turn may take, approvals included */
  maxStepCount: number
  signal: AbortSignal
  /** The call settings besides the tools: models, temperature, output cap */
  options?: Omit<LlmStreamOptions, 'signal' | 'tools' | 'maxSteps'>
  /** The parts and the text so far, after every change */
  onUpdate: (state: ChatToolLoopState) => void
  onModel?: (model: { provider: string; model: string }) => void
}

export interface ChatToolLoopState {
  /** The answer's text: every text part, in order */
  content: string
  parts: ChatMessagePart[]
}

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>

/**
 * The last step of a call answers in words: no tools are offered to it, so a
 * turn ends with an answer rather than with a call nobody will run
 */
function lastStepWithoutTools(stepCount: number): PrepareStep {
  return ({ stepNumber }) =>
    stepNumber >= stepCount - 1 ? { activeTools: [] } : undefined
}

/**
 * One chat turn with tools: streams the answer, records each step as a part of
 * the message, stops for the user's approval and continues, and keeps the turn
 * within its steps. Plain code, so that the same loop serves the chat window
 * and a chat run through the external API
 *
 * Resolves with the final state; aborted, it resolves with what came so far.
 *
 * @throws LlmError
 */
export async function runChatToolLoop(
  deps: ChatToolLoopDependencies,
  input: ChatToolLoopInput
): Promise<ChatToolLoopState> {
  const state: ChatToolLoopState = { content: '', parts: [] }
  const calls = new Map<string, ToolCallPart>()
  let messages: ModelMessage[] = input.prompt.messages
  let stepsUsed = 0
  // a new text part begins after anything that is not text
  const open: {
    text: Extract<ChatMessagePart, { type: 'text' }> | null
    reasoning: Extract<ChatMessagePart, { type: 'reasoning' }> | null
  } = { text: null, reasoning: null }

  const publish = () => {
    state.content = state.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
    input.onUpdate({ content: state.content, parts: [...state.parts] })
  }

  const push = (part: ChatMessagePart) => {
    state.parts.push(part)
    open.text = part.type === 'text' ? part : null
    open.reasoning = part.type === 'reasoning' ? part : null
  }

  const setCallState = (toolCallId: string, callState: ChatToolCallState) => {
    const call = calls.get(toolCallId)
    if (!call) return
    call.state = callState
    if (callState !== 'awaiting-approval') delete call.approvalId
  }

  for (;;) {
    const stepCount = input.maxStepCount - stepsUsed
    if (stepCount < 1) {
      const error = new LlmError(
        'step_limit',
        'The model used up its tool steps without answering'
      )
      error.partialText = state.content
      throw error
    }
    const requests: ChatToolApprovalRequest[] = []
    let finish: Extract<LlmStreamEvent, { type: 'finish' }> | undefined

    const options: LlmStreamOptions = {
      ...input.options,
      signal: input.signal,
      ...(input.tools
        ? {
            tools: input.tools.tools,
            toolApproval: input.tools.toolApproval,
            maxSteps: stepCount,
            prepareStep: lastStepWithoutTools(stepCount),
          }
        : {}),
    }

    for await (const event of deps.stream(
      { ...input.prompt, messages },
      options
    )) {
      switch (event.type) {
        case 'model':
          input.onModel?.({ provider: event.provider, model: event.model })
          continue
        case 'text':
          if (open.text) open.text.text += event.text
          else push({ type: 'text', text: event.text })
          break
        case 'reasoning':
          if (open.reasoning) open.reasoning.text += event.text
          else push({ type: 'reasoning', text: event.text })
          break
        case 'tool-call': {
          const call: ToolCallPart = {
            type: 'tool-call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
            state: 'pending',
          }
          calls.set(event.toolCallId, call)
          push(call)
          break
        }
        case 'tool-result': {
          const output = normalizeToolOutput(event.output)
          setCallState(event.toolCallId, event.isError ? 'error' : 'done')
          push({
            type: 'tool-result',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            output: output.text,
            ...(event.isError ? { isError: true } : {}),
            ...(output.isTruncated ||
            input.tools?.truncatedCallIds.has(event.toolCallId)
              ? { isTruncated: true }
              : {}),
          })
          break
        }
        case 'tool-denied':
          setCallState(event.toolCallId, 'denied')
          break
        case 'approval-request': {
          const call = calls.get(event.toolCallId)
          if (call) {
            call.state = 'awaiting-approval'
            call.approvalId = event.approvalId
          }
          requests.push({
            approvalId: event.approvalId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          })
          break
        }
        case 'step-finish':
          stepsUsed += 1
          continue
        case 'sources':
          push({ type: 'sources', sources: event.sources })
          break
        case 'file':
          // Files are kept from phase 6 on, once there is storage for them
          continue
        case 'finish':
          finish = event
          continue
      }
      publish()
    }

    if (!finish || input.signal.aborted) return state
    if (finish.finishReason === 'stop' || requests.length === 0) return state

    const responses: ModelMessage[] = []
    for (const request of requests) {
      const decision = await deps.requestApproval(request, input.signal)
      if (input.signal.aborted) return state
      const isApproved = deps.policy.answer(request.toolName, decision)
      setCallState(request.toolCallId, isApproved ? 'pending' : 'denied')
      publish()
      responses.push(
        toolApprovalResponse({
          approvalId: request.approvalId,
          approved: isApproved,
          ...(isApproved ? {} : { reason: DENIED_REASON }),
        })
      )
    }
    messages = [...messages, ...finish.responseMessages, ...responses]
  }
}
