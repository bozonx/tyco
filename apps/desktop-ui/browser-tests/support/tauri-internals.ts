/**
 * Installs a stand-in for the Tauri runtime before any page script runs.
 *
 * Playwright serializes this function into the page, so it must not reference
 * anything outside its own body. Commands go to the test process through the
 * exposed `bridgeName` binding; the event plugin is handled in the page so that
 * the test can emit events with `window[emitName](event, payload)`.
 */
export function installTauriInternals({
  bridgeName,
  emitName,
  windowLabel,
}: {
  bridgeName: string
  emitName: string
  windowLabel: string
}) {
  type Callback = (data: unknown) => void
  type BridgeReply =
    { ok: true; value: unknown } | { ok: false; error: unknown }

  const callbacks = new Map<number, Callback>()
  const listeners = new Map<string, number[]>()
  let nextCallbackId = 1
  let nextEventId = 1

  const transformCallback = (callback?: Callback, once = false) => {
    const id = nextCallbackId++
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id)
      callback?.(data)
    })
    return id
  }

  const runCallback = (id: number, data: unknown) => {
    callbacks.get(id)?.(data)
  }

  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) {
      runCallback(handler, { event, id: nextEventId++, payload })
    }
  }

  const handleEventPlugin = (
    command: string,
    args: Record<string, unknown>
  ): unknown => {
    const event = String(args.event)
    switch (command) {
      case 'plugin:event|listen': {
        const handler = Number(args.handler)
        listeners.set(event, [...(listeners.get(event) ?? []), handler])
        return handler
      }
      case 'plugin:event|unlisten': {
        const remaining = (listeners.get(event) ?? []).filter(
          (handler) => handler !== Number(args.eventId)
        )
        listeners.set(event, remaining)
        return null
      }
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        emit(event, args.payload)
        return null
      default:
        return null
    }
  }

  const invoke = async (command: string, args: unknown = {}) => {
    if (command.startsWith('plugin:event|')) {
      return handleEventPlugin(command, args as Record<string, unknown>)
    }
    // the binding is looked up per call: it may be installed after this script
    const bridge = (window as unknown as Record<string, unknown>)[
      bridgeName
    ] as (command: string, args: unknown) => Promise<BridgeReply>
    // binary payloads are not serializable through the binding
    const serializableArgs =
      args instanceof Uint8Array || args instanceof ArrayBuffer
        ? { byteLength: args.byteLength }
        : args
    const reply = await bridge(command, serializableArgs)
    if (!reply.ok) throw reply.error
    return reply.value
  }

  Object.assign(window, {
    isTauri: true,
    [emitName]: emit,
    __TAURI_INTERNALS__: {
      invoke,
      transformCallback,
      unregisterCallback: (id: number) => callbacks.delete(id),
      runCallback,
      callbacks,
      convertFileSrc: (filePath: string, protocol = 'asset') =>
        `${protocol}://localhost/${encodeURIComponent(filePath)}`,
      metadata: {
        currentWindow: { label: windowLabel },
        currentWebview: { windowLabel, label: windowLabel },
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: (_event: string, id: number) => callbacks.delete(id),
    },
  })
}
