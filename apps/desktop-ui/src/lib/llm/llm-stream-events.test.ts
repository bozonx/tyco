import { describe, expect, it } from 'vitest'

import {
  isModelOutput,
  toStreamEvent,
  type KitStreamPart,
} from './llm-stream-events'

const part = (value: object) => value as KitStreamPart

describe('toStreamEvent', () => {
  it('maps a text delta', () => {
    expect(toStreamEvent(part({ type: 'text-delta', text: 'hi' }))).toEqual({
      type: 'text',
      text: 'hi',
    })
  })

  it('skips an approval the rule decided itself', () => {
    expect(
      toStreamEvent(part({ type: 'tool-approval-request', isAutomatic: true }))
    ).toBeUndefined()
  })

  it('leaves the outcome parts to the caller', () => {
    expect(toStreamEvent(part({ type: 'finish' }))).toBeUndefined()
    expect(isModelOutput(part({ type: 'finish' }))).toBe(false)
    expect(isModelOutput(part({ type: 'text-delta' }))).toBe(true)
  })
})
