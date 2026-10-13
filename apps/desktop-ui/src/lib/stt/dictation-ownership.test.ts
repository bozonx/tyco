import { describe, expect, it, vi } from 'vitest'
import { createDictationOwnership } from './dictation-ownership'
import type { LiveDictationStart } from './live-dictation'

const request: LiveDictationStart = {
  model: { id: 'speech', provider: 'deepgram', model: 'nova-3' },
  hasApiKey: true,
  onText: vi.fn(),
  onError: vi.fn(),
}

function setup() {
  const dictation = {
    start: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue('New words'),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
  const owners = createDictationOwnership(dictation)
  return {
    dictation,
    first: owners.createSession(),
    second: owners.createSession(),
  }
}

describe('dictation ownership', () => {
  it('does not let late cleanup or finishing touch another input', async () => {
    const { dictation, first, second } = setup()
    await first.start(request)
    await second.start(request)
    expect(dictation.cancel).toHaveBeenCalledOnce()
    await first.cancel()
    expect(dictation.cancel).toHaveBeenCalledOnce()
    expect(await first.finish()).toBe('')
    expect(await second.finish()).toBe('New words')
    expect(dictation.finish).toHaveBeenCalledOnce()
  })

  it('waits for old capture cleanup before opening the next microphone', async () => {
    const { dictation, first, second } = setup()
    await first.start(request)
    let resolve!: () => void
    dictation.cancel.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const stopping = first.cancel()
    const starting = second.start(request)
    await vi.waitFor(() => expect(dictation.cancel).toHaveBeenCalledOnce())
    expect(dictation.start).toHaveBeenCalledOnce()
    resolve()
    await stopping
    await starting
    expect(dictation.start).toHaveBeenCalledTimes(2)
  })

  it('skips superseded starts and recovers after a failed start', async () => {
    const { dictation, first, second } = setup()
    const superseded = first.start(request)
    const current = second.start(request)
    await Promise.all([superseded, current])
    expect(dictation.start).toHaveBeenCalledOnce()
    dictation.start.mockRejectedValueOnce(new Error('Device unavailable'))
    await expect(first.start(request)).rejects.toThrow('Device unavailable')
    await second.start(request)
    expect(await second.finish()).toBe('New words')
  })
})
