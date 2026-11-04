import { describe, expect, it } from 'vitest'
import {
  createSmartEndpoint,
  SMART_INTER_WORD_SILENCE_MS,
  SMART_MAX_UTTERANCE_MS,
  SMART_SILENCE_MS,
  SMART_SOFT_MAX_UTTERANCE_MS,
} from './smart-endpoint'

function pcm(durationMs: number, value = 0) {
  const samples = new Int16Array(durationMs * 16)
  samples.fill(value)
  return new Uint8Array(samples.buffer)
}

describe('SMART endpointing', () => {
  it('keeps natural pauses inside a turn and ends after sustained silence', () => {
    const model = createSmartEndpoint(16000)
    expect(model.push(pcm(100, 1000))).toEqual({ start: true, end: false })
    expect(model.push(pcm(500))).toEqual({ start: false, end: false })
    expect(model.push(pcm(100, 1000))).toEqual({ start: false, end: false })
    expect(model.push(pcm(SMART_SILENCE_MS))).toEqual({
      start: false,
      end: true,
    })
    expect(model.push(pcm(100, 1000))).toEqual({ start: true, end: false })
  })

  it('ends on inter-word silence once past the soft maximum utterance duration', () => {
    const model = createSmartEndpoint(16000)
    expect(model.push(pcm(SMART_SOFT_MAX_UTTERANCE_MS, 1000))).toEqual({
      start: true,
      end: false,
    })
    expect(model.push(pcm(SMART_INTER_WORD_SILENCE_MS))).toEqual({
      start: false,
      end: true,
    })
  })

  it('bounds uninterrupted speech and handles silence without division by zero', () => {
    const model = createSmartEndpoint(16000)
    expect(model.push(pcm(SMART_MAX_UTTERANCE_MS, 1000))).toEqual({
      start: true,
      end: true,
    })
    expect(model.push(pcm(SMART_SILENCE_MS))).toEqual({
      start: false,
      end: false,
      skip: true,
    })
    expect(model.push(new Uint8Array())).toEqual({
      start: false,
      end: false,
      skip: true,
    })
  })
})
