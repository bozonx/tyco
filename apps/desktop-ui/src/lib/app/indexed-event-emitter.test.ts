import { describe, expect, it, vi } from 'vitest'
import { IndexedEventEmitter } from './indexed-event-emitter'
import { GlobalEvents, type GlobalEventArgs } from './global-events'

describe('IndexedEventEmitter', () => {
  it('delivers payloads to their event and removes only the requested listener', () => {
    const events = new IndexedEventEmitter<GlobalEventArgs>()
    const keyUp = vi.fn()
    const inited = vi.fn()
    const index = events.addListener(GlobalEvents.KEY_UP, keyUp)
    events.addListener(GlobalEvents.INITED, inited)
    const event = new KeyboardEvent('keyup')
    events.emit(GlobalEvents.KEY_UP, event)
    expect(keyUp).toHaveBeenCalledExactlyOnceWith(event)
    expect(inited).not.toHaveBeenCalled()
    events.removeListener(index, GlobalEvents.INITED)
    events.emit(GlobalEvents.KEY_UP, event)
    expect(keyUp).toHaveBeenCalledTimes(2)
    events.removeListener(index)
    events.emit(GlobalEvents.KEY_UP, event)
    expect(keyUp).toHaveBeenCalledTimes(2)
    events.emit(GlobalEvents.INITED)
    expect(inited).toHaveBeenCalledExactlyOnceWith()
  })

  it('honors removals during dispatch and delays new listeners until the next emission', () => {
    const events = new IndexedEventEmitter<GlobalEventArgs>()
    const removed = vi.fn()
    const added = vi.fn()
    const firstIndex = events.addListener(GlobalEvents.INITED, () => {
      events.removeListener(removedIndex)
      events.removeListener(firstIndex)
      events.addListener(GlobalEvents.INITED, added)
    })
    const removedIndex: number = events.addListener(
      GlobalEvents.INITED,
      removed
    )
    events.emit(GlobalEvents.INITED)
    expect(removed).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
    events.emit(GlobalEvents.INITED)
    expect(added).toHaveBeenCalledOnce()
  })

  it('pairs event names with argument tuples', () => {
    const events = new IndexedEventEmitter<GlobalEventArgs>()
    const checkContracts = () => {
      // @ts-expect-error Key events require a keyboard payload.
      events.emit(GlobalEvents.KEY_UP)
      // @ts-expect-error Key events cannot carry strings.
      events.emit(GlobalEvents.KEY_UP, 'key')
      // @ts-expect-error Initialization events do not carry payloads.
      events.emit(GlobalEvents.INITED, new KeyboardEvent('keyup'))
      // @ts-expect-error Unknown event names are rejected.
      events.emit('unknown')
      // @ts-expect-error Listener payloads must match their event.
      events.addListener(GlobalEvents.KEY_UP, (value: string) => value.trim())
    }
    void checkContracts
  })
})
