import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64 } from './base64'

describe('base64 helpers', () => {
  it('round trips binary data without text decoding', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255])

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
