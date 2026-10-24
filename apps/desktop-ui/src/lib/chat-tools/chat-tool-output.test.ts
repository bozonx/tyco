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

  it('includes the continuation note in the output limit', () => {
    const output = normalizeToolOutput('x'.repeat(3000), 2000)
    expect(output.isTruncated).toBe(true)
    expect(output.totalCharacters).toBe(3000)
    expect(output.text.length).toBeLessThanOrEqual(2000)
    const shown = output.text.indexOf('\n\n[Output truncated')
    expect(output.text).toContain(`first ${shown} of 3000 characters`)
    expect(output.text).toContain(`offset ${shown}`)
  })

  it.each([0, 1, 10, 100, 2000])(
    'respects a limit of %i characters',
    (limit) => {
      expect(
        normalizeToolOutput('x'.repeat(3000), limit).text.length
      ).toBeLessThanOrEqual(limit)
    }
  )
})
