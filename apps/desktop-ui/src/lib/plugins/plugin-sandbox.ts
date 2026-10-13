import { watch } from 'vue'
import {
  encodePluginValue,
  decodePluginValue,
  PLUGIN_HOST_METHODS,
  PLUGIN_RPC_LIMITS,
} from '@tyco/plugin-sdk/runtime'
import {
  clonePluginValue,
  type PluginContext,
  type PluginManifest,
} from '@tyco/plugin-sdk'
import { convertDesktopFileSrc as convertFileSrc } from '../desktop/window'

import { createPluginResourceUrl } from './plugin-resource-url'

import { i18n } from '../i18n'
import { messages } from '../i18n/messages'
import { clientLogger } from '../logger'
import { createPluginRpc, type PluginTransport } from './plugin-rpc'

const pluginResourceUrl = (id: string, path: string) =>
  createPluginResourceUrl(id, path, convertFileSrc)

/**
 * Each plugin gets a distinct origin and a worker without app IPC or
 * networking.
 */
export function openPluginTransport(id: string): Promise<PluginTransport> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.src = pluginResourceUrl(id, 'runtime/index.html')
    const channel = new MessageChannel()
    const close = () => {
      channel.port1.postMessage({ type: 'terminate' })
      channel.port1.close()
      channel.port2.close()
      frame.remove()
    }
    const timer = setTimeout(() => {
      close()
      reject(new Error('Plugin sandbox failed to start'))
    }, 5000)
    channel.port1.onmessage = (event) => {
      if (event.data?.type !== 'ready') return
      clearTimeout(timer)
      channel.port1.onmessage = null
      resolve({
        send: (message) => channel.port1.postMessage(message),
        listen: (handler) => {
          channel.port1.onmessage = (event) => handler(event.data)
          return () => {
            channel.port1.onmessage = null
          }
        },
        close,
      })
    }
    // the port goes once: a later load of the frame finds it transferred
    let connected = false
    frame.onload = () => {
      if (connected) return
      connected = true
      frame.contentWindow?.postMessage('tyco-plugin-connect', '*', [
        channel.port2,
      ])
    }
    document.body.append(frame)
  })
}
function snapshot(manifest: PluginManifest) {
  const locale = i18n.global.locale.value
  return clonePluginValue({
    ...messages[locale],
    local: manifest.locales[locale],
  })
}

/**
 * Recreates the isolated runtime on every activation; disabled code is never
 * imported.
 */
export async function activatePluginSandbox(
  manifest: PluginManifest,
  modulePath: string,
  ctx: PluginContext,
  onFailure: (error: Error) => void,
  openTransport: (id: string) => Promise<PluginTransport> = openPluginTransport
): Promise<void> {
  const transport = await openTransport(manifest.id)
  if (ctx.signal.aborted) {
    transport.close()
    throw new Error('Plugin activation cancelled')
  }
  const hostCallbacks = new Map<number, (...args: unknown[]) => unknown>()
  let sequence = 0
  const encode = (value: unknown): unknown =>
    encodePluginValue(value, (callback) => {
      if (hostCallbacks.size >= PLUGIN_RPC_LIMITS.callbacks)
        throw new Error('Too many plugin callbacks')
      const id = ++sequence
      hostCallbacks.set(id, callback as (...args: unknown[]) => unknown)
      return id
    })
  const decode = (value: unknown): unknown =>
    decodePluginValue(value, (callbackId) => async (...args: unknown[]) => {
      const signal = args.find(
        (arg) => arg && typeof arg === 'object' && 'signal' in arg
      ) as { signal?: AbortSignal } | undefined
      const firstCallback = sequence + 1
      const serialized = args.map((arg) =>
        arg && typeof arg === 'object' && 'signal' in arg
          ? { ...(encode(arg) as object), $signal: true }
          : encode(arg)
      )
      const lastCallback = sequence
      try {
        return decode(
          await rpc.request(
            'invoke',
            {
              callback: callbackId,
              args: serialized,
              messages: snapshot(manifest),
            },
            signal?.signal ?? ctx.signal,
            120000,
            { fatalTimeout: false }
          )
        )
      } finally {
        for (let id = firstCallback; id <= lastCallback; id += 1)
          hostCallbacks.delete(id)
      }
    })
  const methods = new Set(PLUGIN_HOST_METHODS)
  const rpc = createPluginRpc({
    transport,
    onFailure: (error) => {
      if (!ctx.signal.aborted) onFailure(error)
    },
    onCleanupError: (error) =>
      clientLogger.error('Plugin cleanup failed', error, manifest.id),
    callHost: async (method, encoded) => {
      if (ctx.signal.aborted) throw new Error('Plugin is disposed')
      const args = decode(encoded) as unknown[]
      if (method === 'callback') {
        const callback = hostCallbacks.get(args[0] as number)
        if (!callback || !Array.isArray(args[1]))
          throw new Error('Unknown host callback')
        return encode(await callback(...args[1]))
      }
      if (!methods.has(method)) throw new Error('Unknown plugin host method')
      if (
        [
          'setEditorInputValue',
          'replaceEditorInputSelection',
          'toEditor',
        ].includes(method) &&
        args[0] !== undefined &&
        typeof args[0] !== 'string'
      )
        throw new Error('Invalid editor argument')
      if (
        ['toast', 'toastText'].includes(method) &&
        (typeof args[0] !== 'string' ||
          !['success', 'error', 'warn', 'info'].includes(String(args[1])))
      )
        throw new Error('Invalid notification arguments')
      if (
        method === 'log' &&
        (!['info', 'warn', 'error', 'debug'].includes(String(args[0])) ||
          typeof args[1] !== 'string')
      )
        throw new Error('Invalid log arguments')
      const fn = ctx[method as keyof PluginContext] as (
        ...args: unknown[]
      ) => unknown
      return encode(await fn(...args))
    },
  })
  const stopMessages = watch(i18n.global.locale, () =>
    rpc.updateMessages(snapshot(manifest))
  )
  const stop = () => {
    stopMessages()
    rpc.abortPending()
  }
  ctx.signal.addEventListener('abort', stop, { once: true })
  ctx.onDispose(async () => {
    stopMessages()
    ctx.signal.removeEventListener('abort', stop)
    try {
      await rpc.request('dispose', {}, undefined, 1500, { fatalTimeout: false })
    } finally {
      rpc.close()
      hostCallbacks.clear()
    }
  })
  try {
    await rpc.request(
      'load',
      {
        manifest: clonePluginValue(manifest),
        url: pluginResourceUrl(manifest.id, modulePath),
      },
      ctx.signal
    )
    await rpc.request(
      'init',
      {
        config: clonePluginValue(ctx.getMyConfig()),
        messages: snapshot(manifest),
      },
      ctx.signal
    )
  } catch (error) {
    stopMessages()
    rpc.close()
    throw error
  }
}
