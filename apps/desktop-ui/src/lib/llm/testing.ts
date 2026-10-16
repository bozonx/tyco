import type { LlmStreamEvent, LlmStreamOptions } from './llm-client'
import type { LlmPrompt } from './llm-prompt'

/** One call of a fake stream: what it was asked and what it answers */
export interface FakeLlmCall {
  prompt: LlmPrompt
  options: LlmStreamOptions
}

/**
 * A stand-in for `LlmClient.stream` that plays scripted calls in order, one
 * list of events per call, and records what each call was asked. A script entry
 * may be a function of the call, or an error to throw
 */
export function createFakeLlmStream(
  script: Array<
    LlmStreamEvent[] | Error | ((call: FakeLlmCall) => LlmStreamEvent[])
  >
) {
  const calls: FakeLlmCall[] = []
  async function* stream(
    prompt: LlmPrompt,
    options: LlmStreamOptions
  ): AsyncGenerator<LlmStreamEvent, void, undefined> {
    const call = { prompt, options }
    calls.push(call)
    const entry = script[calls.length - 1]
    if (entry === undefined)
      throw new Error('The fake stream has no more calls')
    if (entry instanceof Error) throw entry
    const events = typeof entry === 'function' ? entry(call) : entry
    for (const event of events) {
      if (options.signal?.aborted) return
      yield event
    }
  }
  return { stream, calls }
}

/** The events of a plain answer */
export function textAnswer(text: string): LlmStreamEvent[] {
  return [
    { type: 'model', provider: 'fake', model: 'fake-model' },
    { type: 'text', text },
    { type: 'step-finish', step: 0, finishReason: 'stop' },
    { type: 'finish', finishReason: 'stop', text, responseMessages: [] },
  ]
}
