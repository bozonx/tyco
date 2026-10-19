import { describe, expect, it } from 'vitest'

import { resolveSink } from './result-sinks'

const outputAction = 'copyToClipboard' as const

describe('resolveSink', () => {
  it('returns the output whenever the caller asks for it', () => {
    expect(
      resolveSink({ outputAction }, { source: 'launcher', output: 'return' })
    ).toBe('return')
  })

  it('returns the output to an external caller', () => {
    expect(resolveSink({ outputAction }, { source: 'external' })).toBe('return')
  })

  it('shows the output in the menu outside quick commands', () => {
    expect(resolveSink({ outputAction })).toBe('showMenu')
    expect(resolveSink({ outputAction }, { source: 'toolbar' })).toBe(
      'showMenu'
    )
  })

  it('follows the action of quick commands', () => {
    expect(resolveSink({ outputAction }, { source: 'launcher' })).toBe(
      'copyToClipboard'
    )
  })

  it('shows the output in the menu for a quick run with no preference', () => {
    expect(resolveSink({}, { source: 'launcher' })).toBe('showMenu')
  })
})

it.each(['insertIntoWindow', 'copyToClipboard', 'none', 'showMenu'] as const)(
  'shows voice translations in the result menu instead of %s',
  (action) => {
    const invocation = { toolId: 'core.translate', outputAction: action }
    expect(resolveSink(invocation, { source: 'voice' })).toBe('showMenu')
    expect(resolveSink(invocation, { source: 'launcher' })).toBe(action)
    expect(resolveSink(invocation, { source: 'voice', output: 'return' })).toBe(
      'return'
    )
  }
)
