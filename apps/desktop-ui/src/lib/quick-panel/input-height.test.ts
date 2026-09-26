import { describe, expect, it } from 'vitest'

import { MIN_INPUT_HEIGHT, maxInputHeight } from './input-height'

describe('maxInputHeight', () => {
  it('leaves room for the hint, the gap and the frame', () => {
    expect(
      maxInputHeight({
        containerHeight: 484,
        siblingsHeight: 24,
        gapsHeight: 8,
        frameChromeHeight: 2,
      })
    ).toBe(450)
  })

  it('rounds down so the frame never overflows the column', () => {
    expect(
      maxInputHeight({
        containerHeight: 484.7,
        siblingsHeight: 24,
        gapsHeight: 8,
        frameChromeHeight: 2,
      })
    ).toBe(450)
  })

  it('keeps at least one line in a tiny column', () => {
    expect(
      maxInputHeight({
        containerHeight: 20,
        siblingsHeight: 24,
        gapsHeight: 8,
        frameChromeHeight: 2,
      })
    ).toBe(MIN_INPUT_HEIGHT)
  })
})
