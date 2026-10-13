import { describe, expect, it } from 'vitest'

import { bytesToBase64 } from './base64'

describe('base64 helpers', () => {
  it('encodes binary data without text decoding', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255])

    expect(bytesToBase64(bytes)).toBe('AAF/gP7/')
  })
})
