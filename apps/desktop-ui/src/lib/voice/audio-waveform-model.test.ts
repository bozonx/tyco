import { describe, expect, it } from 'vitest'
import {
  createAudioWaveformModel,
  formatWaveformDuration,
} from './audio-waveform-model'

describe('audio waveform model', () => {
  it('formats negative durations and hour boundaries', () => {
    expect(formatWaveformDuration(-100)).toBe('00:00')
    expect(formatWaveformDuration(61_999)).toBe('01:01')
    expect(formatWaveformDuration(3_661_000)).toBe('1:01:01')
  })
  it('clamps audio input and keeps independent animation state', () => {
    const first = createAudioWaveformModel()
    const second = createAudioWaveformModel()
    const frame = first.step({ level: 5, peak: -1, isCompact: true })
    expect(frame).toEqual(second.step({ level: 1, peak: 0, isCompact: true }))
    expect(frame.heights).toHaveLength(32)
    expect(
      frame.heights.every((height) => Number.isFinite(height) && height >= 4)
    ).toBe(true)
    expect(
      frame.opacities.every((opacity) => opacity >= 0.2 && opacity <= 1)
    ).toBe(true)
    expect(
      first.step({ level: 0, peak: 0, isCompact: true }).heights
    ).not.toEqual(
      createAudioWaveformModel().step({ level: 0, peak: 0, isCompact: true })
        .heights
    )
  })
  it('computes static frame with uniform bar heights for reduced motion', () => {
    const model = createAudioWaveformModel()
    const frame = model.staticFrame({ level: 0.5, peak: 0.5, isCompact: true })
    expect(frame.heights).toHaveLength(32)
    const firstHeight = frame.heights[0]
    expect(frame.heights.every((h) => h === firstHeight)).toBe(true)
    expect(firstHeight).toBeGreaterThan(4)
    expect(frame.opacities.every((o) => o === 0.8)).toBe(true)
  })
  it('never grows a bar past its full height, however loud', () => {
    const model = createAudioWaveformModel()
    for (let index = 0; index < 60; index++) {
      const frame = model.step({ level: 1, peak: 1, isCompact: false })
      expect(Math.max(...frame.heights)).toBeLessThanOrEqual(72)
    }
  })
  it('moves the wave by elapsed time, not by frame count', () => {
    // two 120 Hz frames cover what one 60 Hz frame does
    const fast = createAudioWaveformModel()
    const slow = createAudioWaveformModel()
    const input = { level: 0, peak: 0, isCompact: true }
    fast.step({ ...input, timeMs: 0 })
    slow.step({ ...input, timeMs: 0 })
    fast.step({ ...input, timeMs: 1000 / 120 })
    const fastFrame = fast.step({ ...input, timeMs: 1000 / 60 })
    const slowFrame = slow.step({ ...input, timeMs: 1000 / 60 })
    expect(fastFrame.opacities).toEqual(slowFrame.opacities)
  })
})
