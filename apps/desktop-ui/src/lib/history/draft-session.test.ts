import { describe, expect, it, vi } from 'vitest'

import { createDraftSession } from './draft-session'

function createSaver() {
  let counter = 0

  return vi.fn(async () => `id-${++counter}`)
}

describe('draft-session', () => {
  it('replaces the previous draft of the same session', async () => {
    const saveDraft = createSaver()
    const session = createDraftSession(saveDraft)

    await session.snapshot('hello')
    await session.snapshot('hello world')

    expect(saveDraft.mock.calls).toEqual([
      ['hello', undefined],
      ['hello world', 'id-1'],
    ])
  })

  it('skips blank and unchanged texts', async () => {
    const saveDraft = createSaver()
    const session = createDraftSession(saveDraft)

    await session.snapshot('  ')
    await session.snapshot('text')
    await session.snapshot('text')

    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it('starts a new session after the end', async () => {
    const saveDraft = createSaver()
    const session = createDraftSession(saveDraft)

    await session.snapshot('first')
    await session.end('first, edited')
    await session.snapshot('second')

    expect(saveDraft.mock.calls).toEqual([
      ['first', undefined],
      ['first, edited', 'id-1'],
      ['second', undefined],
    ])
  })

  it('saves the same text again only in a new session', async () => {
    const saveDraft = createSaver()
    const session = createDraftSession(saveDraft)

    await session.snapshot('text')
    await session.end('text')
    await session.snapshot('text')

    expect(saveDraft.mock.calls).toEqual([
      ['text', undefined],
      ['text', undefined],
    ])
  })

  it('runs saves one after another', async () => {
    const resolvers: ((id: string) => void)[] = []
    const saveDraft = vi.fn(
      () => new Promise<string | null>((resolve) => resolvers.push(resolve))
    )
    const session = createDraftSession(saveDraft)

    const first = session.snapshot('one')
    const second = session.snapshot('one two')
    await Promise.resolve()

    expect(saveDraft).toHaveBeenCalledTimes(1)

    resolvers[0]!('id-1')
    await first
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
    resolvers[1]!('id-2')
    await second

    expect(saveDraft.mock.calls[1]).toEqual(['one two', 'id-1'])
  })

  it('keeps working after a failed save', async () => {
    const saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce('id-1')
    const session = createDraftSession(saveDraft)

    await session.snapshot('one')
    await session.snapshot('two')

    expect(saveDraft.mock.calls).toEqual([
      ['one', undefined],
      ['two', undefined],
    ])
  })

  it('removes the stored draft when discarded', async () => {
    const saveDraft = vi.fn().mockResolvedValue('id-1')
    const removeDraft = vi.fn(async () => {})
    const session = createDraftSession(saveDraft, removeDraft)

    await session.snapshot('one')
    await session.discard()
    await session.snapshot('two')

    expect(removeDraft).toHaveBeenCalledWith('id-1')
    expect(saveDraft.mock.calls[1]).toEqual(['two', undefined])
  })

  it('removes nothing when discarded before any save', async () => {
    const removeDraft = vi.fn(async () => {})
    const session = createDraftSession(vi.fn(), removeDraft)

    await session.discard()

    expect(removeDraft).not.toHaveBeenCalled()
  })
})
