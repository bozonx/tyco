import { describe, expect, it, vi } from 'vitest'

import { createQuickAiRequestHistory } from './quick-ai-request-history'

const answered = (prompt: string, result: string) => ({
  prompt,
  inputKind: 'text' as const,
  result,
})

function createSetup(
  create = vi.fn(async (): Promise<string | null> => 'entry-1')
) {
  const update = vi.fn(async () => {})
  const history = createQuickAiRequestHistory({ create, update })
  return { history, create, update }
}

describe('quick AI request history', () => {
  it('stores nothing until a turn has a result', async () => {
    const { history, create, update } = createSetup()

    await history.record('Source', null, [{ prompt: 'Hi', inputKind: 'text' }])

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('creates the entry once and updates it with later turns', async () => {
    const { history, create, update } = createSetup()

    await history.record('Source', 'prof-1', [answered('One', 'A')])
    await history.record('Source', 'prof-1', [
      answered('One', 'A'),
      { prompt: 'Two', inputKind: 'voice', result: 'B' },
    ])

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      text: 'Source',
      profileId: 'prof-1',
      instruction: { text: 'One', inputKind: 'typed' },
      turns: [{ prompt: 'One', inputKind: 'typed', result: 'A' }],
    })
    expect(update).toHaveBeenLastCalledWith(
      'entry-1',
      [
        { prompt: 'One', inputKind: 'typed', result: 'A' },
        { prompt: 'Two', inputKind: 'voice', result: 'B' },
      ],
      'B'
    )
    expect(history.sessionId()).toBe('entry-1')
  })

  it('stores the text the user took as the result', async () => {
    const { history, update } = createSetup()

    await history.record('Source', null, [answered('One', 'A')], 'Picked')

    expect(update).toHaveBeenLastCalledWith(
      'entry-1',
      [{ prompt: 'One', inputKind: 'typed', result: 'A' }],
      'Picked'
    )
  })

  it('does not create the entry twice for writes in flight', async () => {
    let finish!: (id: string) => void
    const create = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve))
    )
    const { history, update } = createSetup(create)

    const first = history.record('Source', null, [answered('One', 'A')])
    const second = history.record('Source', null, [answered('One', 'A')], 'A')
    await vi.waitFor(() => expect(create).toHaveBeenCalled())
    finish('entry-1')
    await Promise.all([first, second])

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('keeps writing after a failed write', async () => {
    const create = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue('entry-2')
    const { history, update } = createSetup(create)

    await history.record('Source', null, [answered('One', 'A')])
    await history.record('Source', null, [answered('One', 'A')])

    expect(create).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith('entry-2', expect.any(Array), 'A')
  })
})
