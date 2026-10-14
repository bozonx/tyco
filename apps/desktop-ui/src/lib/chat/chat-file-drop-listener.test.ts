import { describe, expect, it, vi } from 'vitest'
import { createChatFileDropListener } from './chat-file-drop-listener'
import type { FileDropEvent } from './chat-file-drop-target'

function fixture() {
  let handler!: (event: FileDropEvent) => void
  const cleanup = vi.fn()
  const deps = {
    getBounds: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    getScale: () => 1,
    canAccept: () => true,
    setDragging: vi.fn(),
    accept: vi.fn(async () => {}),
    reportError: vi.fn(),
    subscribe: vi.fn(async (callback: (event: FileDropEvent) => void) => {
      handler = callback
      return cleanup
    }),
  }
  const listener = createChatFileDropListener(deps)
  return {
    deps,
    cleanup,
    listener,
    deliver: (event: FileDropEvent) => handler(event),
  }
}

describe('chat native drop lifetime', () => {
  it('registers once, forwards files and ignores events after disposal', async () => {
    const f = fixture()
    await Promise.all([f.listener.start(), f.listener.start()])
    expect(f.deps.subscribe).toHaveBeenCalledOnce()
    const event = {
      type: 'drop' as const,
      position: { x: 50, y: 50 },
      paths: ['/image.png'],
    }
    f.deliver(event)
    await Promise.resolve()
    expect(f.deps.accept).toHaveBeenCalledWith(['/image.png'])
    f.listener.dispose()
    f.listener.dispose()
    f.deliver(event)
    expect(f.deps.accept).toHaveBeenCalledOnce()
    expect(f.cleanup).toHaveBeenCalledOnce()
  })

  it('cleans up a registration that arrives after disposal', async () => {
    const f = fixture()
    let finish!: (cleanup: typeof f.cleanup) => void
    f.deps.subscribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = f.listener.start()
    f.listener.dispose()
    finish(f.cleanup)
    await pending
    expect(f.cleanup).toHaveBeenCalledOnce()
  })

  it('reports registration and import failures', async () => {
    const f = fixture()
    const error = new Error('Unavailable')
    f.deps.subscribe.mockRejectedValueOnce(error)
    await f.listener.start()
    expect(f.deps.reportError).toHaveBeenCalledWith(
      'Failed to register chat file drop listener',
      error
    )
    const active = fixture()
    active.deps.accept.mockRejectedValue(error)
    await active.listener.start()
    active.deliver({
      type: 'drop',
      position: { x: 50, y: 50 },
      paths: ['/image.png'],
    })
    await vi.waitFor(() =>
      expect(active.deps.reportError).toHaveBeenCalledWith(
        'Failed to import dropped chat files',
        error
      )
    )
    active.listener.dispose()
  })
})
