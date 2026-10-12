import { describe, expect, it } from 'vitest'

import { resolveSink } from './result-sinks'

const launcherSink = { action: 'copy', fallback: 'none' } as const

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

  it('follows the action of quick commands with or without a selection', () => {
    expect(
      resolveSink({ launcherSink }, { source: 'launcher', hasSelection: true })
    ).toBe('copy')
    expect(resolveSink({ launcherSink }, { source: 'launcher' })).toBe('copy')
  })

  it('falls back when there is no selection to replace', () => {
    const replacing = {
      launcherSink: { action: 'replaceSelection', fallback: 'none' },
    } as const
    expect(
      resolveSink(replacing, { source: 'launcher', hasSelection: true })
    ).toBe('replaceSelection')
    expect(resolveSink(replacing, { source: 'launcher' })).toBe('none')
  })

  it('shows the output in the menu for a quick run with no preference', () => {
    expect(resolveSink({}, { source: 'launcher', hasSelection: true })).toBe(
      'showMenu'
    )
  })
})
