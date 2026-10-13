export type DefaultHandler = (...args: any[]) => void

export class IndexedEventEmitter<T extends DefaultHandler = DefaultHandler> {
  private handlers: (T | undefined)[] = []
  private indexes: { [index: string]: number[] } = {}
  private handlerEvents: (string | number | undefined)[] = []

  emit = (eventName: string | number, ...args: any[]) => {
    if (!this.indexes[eventName]) return
    const indexes = [...this.indexes[eventName]]
    for (const index of indexes) {
      const handler = this.handlers[index]
      if (handler) handler(...args)
    }
  }

  addListener(eventName: string | number, handler: T): number {
    if (!this.indexes[eventName]) this.indexes[eventName] = []
    const index = this.handlers.length
    this.handlers.push(handler)
    this.handlerEvents.push(eventName)
    this.indexes[eventName].push(index)
    return index
  }

  removeListener(handlerIndex: number, eventName?: string | number): void {
    const resolvedEventName = eventName ?? this.handlerEvents[handlerIndex]
    if (resolvedEventName === undefined) return
    if (!this.indexes[resolvedEventName]) return
    const foundIndexInEvents = this.indexes[resolvedEventName].findIndex(
      (item) => item === handlerIndex
    )
    if (foundIndexInEvents >= 0) {
      this.indexes[resolvedEventName].splice(foundIndexInEvents, 1)
      if (!this.indexes[resolvedEventName].length)
        delete this.indexes[resolvedEventName]
      delete this.handlers[handlerIndex]
      delete this.handlerEvents[handlerIndex]
    }
  }
}
