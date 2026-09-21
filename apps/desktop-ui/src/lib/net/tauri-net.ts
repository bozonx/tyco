import type { Transport } from '@bozonx/ai-kit'
import { Channel, invoke } from '@tauri-apps/api/core'

import type { NetIpc } from './net-ipc'
import { createTauriFetch } from './tauri-fetch'
import { createTauriSocketOpener } from './tauri-socket'

export const tauriNetIpc: NetIpc = {
  invoke: (command, args, options) =>
    invoke(command, args, options?.headers && { headers: options.headers }),
  createChannel(onMessage) {
    const channel = new Channel<unknown>()
    channel.onmessage = onMessage
    return channel
  },
}

/** The `transport` for `createAiKit`: every request leaves from Rust */
export function createTauriTransport(ipc: NetIpc = tauriNetIpc): Transport {
  return {
    fetch: createTauriFetch(ipc),
    openSocket: createTauriSocketOpener(ipc),
  }
}
