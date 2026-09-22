import { describe, expect, it, vi } from 'vitest'

import { createActivationMetricsClient } from './activation-metrics'

describe('activation metrics client', () => {
  it('marks the frame and submits the requested trial value', async () => {
    const handlers = new Map<string, (payload: { id: number }) => void>()
    const mark = vi.fn()
    const submitValue = vi.fn()
    const client = createActivationMetricsClient({
      listen: async (event, handler) => {
        handlers.set(event, handler)
        return vi.fn()
      },
      mark,
      submitValue,
      requestFrame: (handler) => handler(),
      eventTarget: document,
    })
    await client.start()

    handlers.get('start')?.({ id: 4 })
    handlers.get('collect')?.({ id: 4 })

    expect(mark).toHaveBeenCalledWith(4, 'frame')
    expect(submitValue).toHaveBeenCalledWith(4)
    client.stop()
  })

  it('marks only the first printable editor key', async () => {
    const handlers = new Map<string, (payload: { id: number }) => void>()
    const mark = vi.fn()
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const input = document.createElement('div')
    editor.append(input)
    document.body.append(editor)
    const client = createActivationMetricsClient({
      listen: async (event, handler) => {
        handlers.set(event, handler)
        return vi.fn()
      },
      mark,
      submitValue: vi.fn(),
      requestFrame: vi.fn(),
      eventTarget: document,
    })
    await client.start()
    handlers.get('start')?.({ id: 9 })

    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))

    expect(mark.mock.calls.filter((call) => call[1] === 'first-char')).toEqual([
      [9, 'first-char'],
    ])
    client.stop()
    editor.remove()
  })
})
