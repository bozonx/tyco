/** Event names and argument tuples stay paired for listeners and emissions. */
export class IndexedEventEmitter<
  Events extends { [K in keyof Events]: unknown[] },
> {
  private handlers: {
    [K in keyof Events]?: Map<number, (...args: Events[K]) => void>
  } = {}
  private handlerEvents = new Map<number, keyof Events>()
  private lastHandlerIndex = 0

  emit = <K extends keyof Events>(eventName: K, ...args: Events[K]): void => {
    const handlers = this.handlers[eventName]
    if (!handlers) return
    for (const index of [...handlers.keys()]) {
      handlers.get(index)?.(...args)
    }
  }

  addListener<K extends keyof Events>(
    eventName: K,
    handler: (...args: Events[K]) => void
  ): number {
    const handlers = (this.handlers[eventName] ??= new Map())
    const index = this.lastHandlerIndex++
    handlers.set(index, handler)
    this.handlerEvents.set(index, eventName)
    return index
  }

  removeListener(handlerIndex: number, eventName?: keyof Events): void {
    const resolvedEventName = eventName ?? this.handlerEvents.get(handlerIndex)
    if (resolvedEventName === undefined) return
    const handlers = this.handlers[resolvedEventName]
    if (!handlers?.delete(handlerIndex)) return
    this.handlerEvents.delete(handlerIndex)
    if (!handlers.size) delete this.handlers[resolvedEventName]
  }
}
