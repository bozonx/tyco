import type { AiKit } from '@bozonx/ai-kit'

import type { LlmStreamEvent } from './llm-client'

export type KitStreamPart =
  ReturnType<AiKit['stream']> extends AsyncIterable<infer Part> ? Part : never

/**
 * The event of a stream part that maps one to one; parts that carry the outcome
 * of the call (`error`, `finish`) and unknown ones give undefined
 */
export function toStreamEvent(part: KitStreamPart): LlmStreamEvent | undefined {
  switch (part.type) {
    case 'model':
      return { type: 'model', provider: part.provider, model: part.model }
    case 'text-delta':
      return { type: 'text', text: part.text }
    case 'reasoning-delta':
      return { type: 'reasoning', text: part.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.args,
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.result,
        isError: part.isError === true,
      }
    case 'tool-denied':
      return {
        type: 'tool-denied',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
      }
    case 'tool-approval-request':
      // a decision the approval rule made itself is not asked about
      if (part.isAutomatic) return undefined
      return {
        type: 'approval-request',
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.args,
      }
    case 'step-finish':
      return {
        type: 'step-finish',
        step: part.step,
        finishReason: part.finishReason,
      }
    case 'file':
      return { type: 'file', mediaType: part.mediaType, data: part.data }
    case 'sources':
      return { type: 'sources', sources: part.sources }
    default:
      return undefined
  }
}

/** Whether the part is model output, after which a retry would repeat it */
export const isModelOutput = (part: KitStreamPart): boolean =>
  part.type !== 'model' &&
  part.type !== 'step-finish' &&
  part.type !== 'error' &&
  part.type !== 'finish'
