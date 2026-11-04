import { describe, expect, it, vi } from 'vitest'
import { createContextualCorrectionModel } from './contextual-correction'

const response = (old: string, next: string) => ({
  edits: [{ old, new: next, reason: 'Sound-alike recognition error' }],
})
function setup(
  request = vi
    .fn<(text: string, signal: AbortSignal) => Promise<unknown>>()
    .mockResolvedValue({ edits: [] })
) {
  const onText = vi.fn()
  const onError = vi.fn()
  const model = createContextualCorrectionModel({
    request,
    onText,
    onError,
    timeoutMs: 100,
  })
  return { model, request, onText, onError }
}

describe('contextual correction', () => {
  it('applies a unique minimal replacement while retaining the source', async () => {
    const { model, request } = setup(
      vi
        .fn()
        .mockResolvedValue(
          response('Call Jon tomorrow.', 'Call John tomorrow.')
        )
    )
    model.update('Call Jon tomorrow.')
    expect(await model.finish('Call Jon tomorrow.')).toBe('Call John tomorrow.')
    expect(model.source).toBe('Call Jon tomorrow.')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Jon and Jon', 'Jon', 'John'],
    ['Call Jon tomorrow.', 'missing', 'John'],
    [
      'Call Jon tomorrow.',
      'Call Jon tomorrow.',
      'Arrange a meeting next week.',
    ],
    ['Use port 1234.', 'Use port 1234.', 'Use port 1235.'],
    ['Run `git push`.', 'Run `git push`.', 'Run `git pull`.'],
    ['Run `npm install` now.', 'install', 'uninstall'],
    ['Run npm install packages.', 'install', 'uninstall'],
    ['Use myValue please.', 'myValue', 'myValues'],
    ['Open src/main.ts.', 'Open src/main.ts.', 'Open src/menu.ts.'],
  ])(
    'rejects ambiguous, absent or unsafe replacements: %s',
    async (text, old, next) => {
      const { model } = setup(vi.fn().mockResolvedValue(response(old, next)))
      expect(await model.finish(text)).toBe(text)
    }
  )

  it('serializes requests and applies valid edits while coalescing growth', async () => {
    let resolve!: (value: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue({ edits: [] })
    const { model } = setup(request)
    model.update('Call Jon.')
    model.update('Call Jon. Then wait.')
    model.update('Call Jon. Then wait. Continue.')
    expect(request).toHaveBeenCalledTimes(1)
    resolve(response('Call Jon.', 'Call John.'))
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(await model.finish('Call Jon. Then wait. Continue.')).toBe(
      'Call John. Then wait. Continue.'
    )
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('protects manual edits from pending and subsequent responses', async () => {
    let resolve!: (value: unknown) => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(response('Call Jon tomorrow.', 'Call John tomorrow.'))
    const { model } = setup(request)
    model.update('Call Jon.')
    model.editText('Call Jon tomorrow.')
    resolve(response('Call Jon.', 'Call John.'))
    expect(await model.finish('Call Jon.')).toBe('Call Jon tomorrow.')
  })

  it('preserves subsequent spoken text after manual edits instead of dropping it', async () => {
    const { model } = setup()
    model.update('Initial speech.')
    model.editText('Initial speech edited.')
    // Subsequent speech adds more text
    model.update('Initial speech. More speech.')
    expect(await model.finish('Initial speech. More speech.')).toBe(
      'Initial speech edited. More speech.'
    )
  })

  it('preserves prior corrections across boundary and whitespace adjustments', async () => {
    const { model } = setup(
      vi
        .fn()
        .mockResolvedValueOnce(response('Call Jon.', 'Call John.'))
        .mockResolvedValue({ edits: [] })
    )
    model.update('Call Jon.')
    // Wait for correction to apply
    await vi.waitFor(() => expect(model.text).toBe('Call John.'))
    // New speech arrives where punctuation is glued or whitespace changes
    model.update('Call Jon. Next sentence.')
    expect(await model.finish('Call Jon. Next sentence.')).toBe(
      'Call John. Next sentence.'
    )
  })

  it('aborts cancellation and suppresses late delivery', async () => {
    let resolve!: (value: unknown) => void
    const { model, onText, onError, request } = setup(
      vi.fn().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    model.update('Call Jon.')
    model.cancel()
    resolve(response('Call Jon.', 'Call John.'))
    await model.finish('Call Jon.')
    expect(request.mock.calls[0][1].aborted).toBe(true)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('bounds hung requests and reports malformed responses without losing text', async () => {
    vi.useFakeTimers()
    try {
      const { model, onError } = setup(
        vi.fn().mockImplementation(() => new Promise(() => {}))
      )
      const result = model.finish('Available transcript.')
      await vi.advanceTimersByTimeAsync(100)
      expect(await result).toBe('Available transcript.')
      expect(onError).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
    const { model, onError } = setup(
      vi.fn().mockResolvedValue({ edits: [{ old: 'bad' }] })
    )
    expect(await model.finish('Available transcript.')).toBe(
      'Available transcript.'
    )
    expect(onError).toHaveBeenCalledOnce()
  })

  it('rejects overlaps and applies disjoint edits against the same snapshot', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        edits: [
          ...response('Call Jon tomorrow.', 'Call John tomorrow.').edits,
          ...response('Jon tomorrow', 'John tomorrow').edits,
          ...response('Meet Mari later.', 'Meet Mary later.').edits,
        ],
      })
    const { model } = setup(request)
    expect(await model.finish('Call Jon tomorrow. Meet Mari later.')).toBe(
      'Call John tomorrow. Meet Mary later.'
    )
  })
})
