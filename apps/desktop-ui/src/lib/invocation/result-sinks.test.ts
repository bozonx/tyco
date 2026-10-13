import { describe, expect, it } from 'vitest'

import { resolveSink } from './result-sinks'

const launcherSink = { action: 'copy' } as const

describe('resolveSink', () => {
  it('returns the output whenever the caller asks for it', () => {
    expect(
      resolveSink({ launcherSink }, { source: 'launcher', output: 'return' })
    ).toBe('return')
  })

  it('returns the output to an external caller', () => {
    expect(resolveSink({ launcherSink }, { source: 'external' })).toBe('return')
  })

  it('shows the output in the menu outside quick commands', () => {
    expect(resolveSink({ launcherSink })).toBe('showMenu')
    expect(resolveSink({ launcherSink }, { source: 'toolbar' })).toBe(
      'showMenu'
    )
  })

  it('follows the action of quick commands', () => {
    expect(resolveSink({ launcherSink }, { source: 'launcher' })).toBe('copy')
  })

  it('shows the output in the menu for a quick run with no preference', () => {
    expect(resolveSink({}, { source: 'launcher' })).toBe('showMenu')
  })
})
