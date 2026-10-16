import { describe, expect, it } from 'vitest'

import { normalizeToolOutput } from './chat-tool-output'

describe('chat-tool-output', () => {
  it('passes text through and writes structures as JSON', () => {
    expect(normalizeToolOutput('12:00')).toEqual({
      text: '12:00',
      isTruncated: false,
      totalCharacters: 5,
    })
    expect(normalizeToolOutput({ a: 1 }).text).toBe('{\n  "a": 1\n}')
    expect(normalizeToolOutput(undefined).text).toBe('')
    expect(normalizeToolOutput(new Error('No such file')).text).toBe(
      'No such file'
    )
  })

  it('cuts a long output and tells the model how to read on', () => {
    const output = normalizeToolOutput('x'.repeat(30), 10)

    expect(output.isTruncated).toBe(true)
    expect(output.totalCharacters).toBe(30)
    expect(
      output.text.startsWith('x'.repeat(10) + '\n\n[Output truncated')
    ).toBe(true)
    expect(output.text).toContain('first 10 of 30 characters')
    expect(output.text).toContain('offset 10')
  })
})
