import { describe, expect, it, vi } from 'vitest'

import type { DialogSegment } from './dialog-transcript'
import {
  createDialogTranslationQueue,
  type DialogTranslationRequest,
} from './dialog-translation'

function segment(
  id: string,
  side: DialogSegment['side'] = 'remote',
  startMs = 0
): DialogSegment {
  return {
    id,
    side,
    startMs,
    endMs: startMs,
    text: `text ${id}`,
    isFinal: true,
    translationState: 'idle',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('createDialogTranslationQueue', () => {
  it('translates segments of the other side in order with earlier context', async () => {
    const requests: DialogTranslationRequest[] = []
    const updates: [string, unknown][] = []
    const queue = createDialogTranslationQueue({
      translate: async (request) => {
        requests.push(request)
        return ` ${request.text.toUpperCase()} `
      },
      targetLanguage: () => 'ru-RU',
      onUpdate: (id, patch) => updates.push([id, patch]),
      contextSize: 1,
    })
    queue.enqueue(segment('a'))
    queue.enqueue(segment('me', 'me'))
    queue.enqueue(segment('b', 'remote', 10_000))
    queue.enqueue(segment('c', 'remote', 20_000))
    await queue.idle()
    expect(requests.map((request) => [request.text, request.context])).toEqual([
      ['text a', []],
      ['text b', [{ side: 'me', text: 'text me' }]],
      ['text c', [{ side: 'remote', text: 'text b' }]],
    ])
    expect(requests[0].targetLanguage).toBe('ru-RU')
    expect(updates.filter(([id]) => id === 'b')).toEqual([
      ['b', { translationState: 'pending' }],
      ['b', { translationState: 'complete', translation: 'TEXT B' }],
    ])
    expect(updates.some(([id]) => id === 'me')).toBe(false)
  })

  it('takes what waited meanwhile in one request', async () => {
    const first = deferred<string>()
    const requests: string[] = []
    const updates: [string, unknown][] = []
    const queue = createDialogTranslationQueue({
      translate: ({ text }) => {
        requests.push(text)
        return requests.length === 1 ? first.promise : Promise.resolve('BC')
      },
      targetLanguage: () => 'ru-RU',
      onUpdate: (id, patch) => updates.push([id, patch]),
    })
    queue.enqueue(segment('a'))
    queue.enqueue(segment('b', 'remote', 500))
    queue.enqueue(segment('c', 'remote', 1000))
    queue.enqueue(segment('reply', 'me', 1200))
    queue.enqueue(segment('d', 'remote', 1500))
    first.resolve('A')
    await queue.idle()
    expect(requests).toEqual(['text a', 'text b text c', 'text d'])
    expect(updates).toContainEqual([
      'b',
      { translationState: 'complete', translation: 'BC' },
    ])
    expect(updates).toContainEqual([
      'c',
      { translationState: 'complete', translation: '' },
    ])
  })

  it('translates a failed segment again', async () => {
    let attempt = 0
    const updates: [string, unknown][] = []
    const queue = createDialogTranslationQueue({
      translate: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('offline')
        return 'ok'
      },
      targetLanguage: () => 'ru-RU',
      onUpdate: (id, patch) => updates.push([id, patch]),
    })
    const failed = segment('a')
    queue.enqueue(failed)
    await queue.idle()
    queue.retry(failed)
    await queue.idle()
    expect(updates.at(-1)).toEqual([
      'a',
      { translationState: 'complete', translation: 'ok' },
    ])
  })

  it('marks a failed segment and goes on with the next', async () => {
    const updates: [string, unknown][] = []
    const logError = vi.fn()
    const queue = createDialogTranslationQueue({
      translate: async ({ text }) => {
        if (text === 'text a') throw new Error('offline')
        return 'ok'
      },
      targetLanguage: () => 'de-DE',
      onUpdate: (id, patch) => updates.push([id, patch]),
      logError,
    })
    queue.enqueue(segment('a'))
    queue.enqueue(segment('b', 'remote', 10_000))
    await queue.idle()
    expect(updates).toContainEqual(['a', { translationState: 'failed' }])
    expect(updates).toContainEqual([
      'b',
      { translationState: 'complete', translation: 'ok' },
    ])
    expect(logError).toHaveBeenCalledOnce()
  })

  it('does nothing without a target language', async () => {
    const translate = vi.fn()
    const onUpdate = vi.fn()
    const queue = createDialogTranslationQueue({
      translate,
      targetLanguage: () => '',
      onUpdate,
    })
    queue.enqueue(segment('a'))
    await queue.idle()
    expect(translate).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('drops what waits when cleared', async () => {
    const first = deferred<string>()
    const updates: [string, unknown][] = []
    const queue = createDialogTranslationQueue({
      translate: ({ text }) =>
        text === 'text a' ? first.promise : Promise.resolve('b'),
      targetLanguage: () => 'fr-FR',
      onUpdate: (id, patch) => updates.push([id, patch]),
    })
    queue.enqueue(segment('a'))
    queue.enqueue(segment('b'))
    queue.clear()
    first.resolve('late')
    await Promise.resolve()
    await queue.idle()
    expect(
      updates.filter(([, patch]) =>
        ['complete', 'failed'].includes(
          (patch as { translationState: string }).translationState
        )
      )
    ).toEqual([])
  })
})
