import type { NetIpc } from './net-ipc'

export interface FakeInvokeCall {
  command: string
  args: Record<string, unknown> | Uint8Array | undefined
  headers: Record<string, string> | undefined
}

type Emit = (message: unknown) => void

type Handler = (call: FakeInvokeCall, emit: Emit) => unknown

/**
 * A stand-in for the Tauri IPC in tests. Records every call; a handler per
 * command decides what it returns and may emit events on the call's channel.
 */
export function createFakeNetIpc(handlers: Record<string, Handler> = {}) {
  const calls: FakeInvokeCall[] = []
  const channels = new Map<unknown, Emit>()
  let lastEmit: Emit = () => undefined

  const ipc: NetIpc = {
    async invoke<T>(
      command: string,
      args?: Record<string, unknown> | Uint8Array,
      options?: { headers?: Record<string, string> }
    ) {
      const call = { command, args, headers: options?.headers }
      calls.push(call)
      const channel =
        args && !(args instanceof Uint8Array) ? args.onEvent : undefined
      const emit = channels.get(channel) ?? (() => undefined)
      const handler = handlers[command]
      return (await handler?.(call, emit)) as T
    },
    createChannel(onMessage) {
      const channel = { id: channels.size + 1 }
      channels.set(channel, onMessage)
      lastEmit = onMessage
      return channel
    },
  }

  return {
    ipc,
    calls,
    /** Emits on the most recently created channel */
    emit: (message: unknown) => lastEmit(message),
    callsOf: (command: string) =>
      calls.filter((call) => call.command === command),
  }
}

export function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}
