import { describe, expect, it, vi } from 'vitest'

import { createVisibleWork } from './visible-work'

describe('createVisibleWork', () => {
  it('answers once every registered work has ended', async () => {
    const order: string[] = []
    const answer = vi.fn(async (id: number) => {
      order.push(`answer ${id}`)
    })
    const work = createVisibleWork({ answer })
    work.register(async () => {
      await Promise.resolve()
      order.push('dictation saved')
    })
    const remove = work.register(() => {
      order.push('removed')
    })
    remove()
    await work.end(3)
    expect(order).toEqual(['dictation saved', 'answer 3'])
  })

  it('answers after the timeout when a work does not end', async () => {
    const answer = vi.fn(async () => {})
    let expire!: () => void
    const work = createVisibleWork({
      answer,
      setTimeout: (callback) => {
        expire = callback
        return 1
      },
      clearTimeout: () => {},
    })
    work.register(() => new Promise<void>(() => {}))
    const ended = work.end(1)
    await Promise.resolve()
    expect(answer).not.toHaveBeenCalled()
    expire()
    await ended
    expect(answer).toHaveBeenCalledWith(1)
  })

  it('answers even when a work fails', async () => {
    const answer = vi.fn(async () => {})
    const reportError = vi.fn()
    const work = createVisibleWork({ answer, reportError })
    work.register(() => {
      throw new Error('broken')
    })
    await work.end(2)
    expect(reportError).toHaveBeenCalled()
    expect(answer).toHaveBeenCalledWith(2)
  })
})
