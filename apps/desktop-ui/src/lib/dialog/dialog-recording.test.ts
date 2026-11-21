import { describe, expect, it } from 'vitest'

import { formatRecordingElapsed } from './dialog-recording'

describe('dialog recording', () => {
  it('formats the elapsed time', () => {
    expect(formatRecordingElapsed(-5)).toBe('0:00')
    expect(formatRecordingElapsed(65_900)).toBe('1:05')
    expect(formatRecordingElapsed(3_600_000 + 61_000)).toBe('1:01:01')
  })
})
