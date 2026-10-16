import { describe, expect, it } from 'vitest'

import { summarizeFileChange } from './chat-tool-diff'

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n') +
  '\n'

describe('chat-tool-diff', () => {
  it('shows a new file as added lines', () => {
    expect(summarizeFileChange(null, 'one\ntwo\n')).toEqual({
      lines: [
        { kind: 'added', text: 'one' },
        { kind: 'added', text: 'two' },
      ],
      addedCount: 2,
      removedCount: 0,
      hiddenCount: 0,
    })
  })

  it('keeps three lines around a change and folds the rest', () => {
    const before = numbered(20)
    const after = before.replace('line 10\n', 'line ten\n')

    const summary = summarizeFileChange(before, after)

    expect(summary.lines[0]).toEqual({ kind: 'gap', count: 6 })
    expect(summary.lines.slice(1, 4).map((line) => line.kind)).toEqual([
      'context',
      'context',
      'context',
    ])
    expect(summary.lines.slice(4, 6)).toEqual([
      { kind: 'removed', text: 'line 10' },
      { kind: 'added', text: 'line ten' },
    ])
    expect(summary.lines.at(-1)).toEqual({ kind: 'gap', count: 7 })
    expect(summary).toMatchObject({ addedCount: 1, removedCount: 1 })
  })

  it('counts the changed lines it leaves out', () => {
    const summary = summarizeFileChange(null, numbered(10), 4)

    expect(summary.lines).toHaveLength(4)
    expect(summary.hiddenCount).toBe(6)
    expect(summary.addedCount).toBe(10)
  })

  it('shows nothing for an unchanged file', () => {
    expect(summarizeFileChange('same\n', 'same\n').lines).toEqual([
      { kind: 'gap', count: 1 },
    ])
  })
})
