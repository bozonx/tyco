import type { Transport } from '@bozonx/ai-kit'
import { Channel } from '@tauri-apps/api/core'

import { invokeDesktop as invoke } from '../desktop/invoke'
import type { NetIpc } from './net-ipc'
import { createProviderFetch } from './provider-fetch'
import { createTauriFetch } from './tauri-fetch'
import { createTauriSocketOpener } from './tauri-socket'

export const tauriNetIpc: NetIpc = {
  invoke,
  createChannel(onMessage) {
    const channel = new Channel<unknown>()
    channel.onmessage = onMessage
    return channel
  },
}

/** The `transport` for `createAiKit`: every request leaves from Rust */
export function createTauriTransport(ipc: NetIpc = tauriNetIpc): Transport {
  return {
    fetch: createProviderFetch(createTauriFetch(ipc)),
    openSocket: createTauriSocketOpener(ipc),
  }
}
