import type { PluginContext, PluginManifest } from '@tyco/plugin-sdk'
import { convertFileSrc } from '@tauri-apps/api/core'

import { i18n } from '../i18n'
import { messages } from '../i18n/messages'
import { createPluginRpc, type PluginTransport } from './plugin-rpc'

/** The frame never receives application IPC privileges or plugin code. */
export function openPluginTransport(): Promise<PluginTransport> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.src = convertFileSrc('runtime/index.html', 'tyco-plugin')
    const channel = new MessageChannel()
    const close = () => {
      channel.port1.postMessage({ type: 'terminate' })
      channel.port1.close()
      channel.port2.close()
      frame.remove()
    }
    const timer = setTimeout(() => { close(); reject(new Error('Plugin sandbox failed to start')) }, 5000)
    channel.port1.onmessage = (event) => {
      if (event.data?.type !== 'ready') return
      clearTimeout(timer)
      channel.port1.onmessage = null
      resolve({
        send: (message) => channel.port1.postMessage(message),
        listen: (handler) => {
          channel.port1.onmessage = (event) => handler(event.data)
          return () => { channel.port1.onmessage = null }
        },
        close,
      })
    }
    frame.onload = () => frame.contentWindow?.postMessage('tyco-plugin-connect', '*', [channel.port2])
    frame.onerror = () => { clearTimeout(timer); close(); reject(new Error('Plugin sandbox failed to load')) }
    document.body.append(frame)
  })
}
function merge(base: Record<string, unknown>, translated: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(translated)) result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge((base[key] as Record<string, unknown>) ?? {}, value as Record<string, unknown>) : value
  return result
}
function snapshot(manifest: PluginManifest) {
  const locale = i18n.global.locale.value
  return {
    ...merge(messages.en_US, messages[locale]),
    local: merge(manifest.locales[manifest.defaultLocale], manifest.locales[locale] ?? {}),
  }
}

/** Recreates the isolated runtime on every activation; disabled code is never imported. */
export async function activatePluginSandbox(
  manifest: PluginManifest,
  modulePath: string,
  ctx: PluginContext,
  onFailure: (error: Error) => void
): Promise<void> {
  const transport = await openPluginTransport()
  if (ctx.signal.aborted) { transport.close(); throw new Error('Plugin activation cancelled') }
  const hostCallbacks = new Map<number, (...args: unknown[]) => unknown>()
  let sequence = 0
  const encode = (value: unknown): unknown => {
    if (typeof value === 'function') {
      const id = ++sequence
      hostCallbacks.set(id, value as (...args: unknown[]) => unknown)
      return { $callback: id }
    }
    if (value instanceof Date) return { $date: value.toISOString() }
    if (value instanceof AbortSignal) return undefined
    if (Array.isArray(value)) return value.map(encode)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)]))
    return value
  }
  const decode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(decode)
    if (value && typeof value === 'object') {
      const entry = value as Record<string, unknown>
      if (Number.isSafeInteger(entry.$callback) && Object.keys(entry).length === 1) {
        return async (...args: unknown[]) => {
          const signal = args.find((arg) => arg && typeof arg === 'object' && 'signal' in arg) as { signal?: AbortSignal } | undefined
          const serialized = args.map((arg) => arg && typeof arg === 'object' && 'signal' in arg ? { ...encode(arg) as object, $signal: true } : encode(arg))
          return decode(await rpc.request('invoke', { callback: entry.$callback, args: serialized, messages: snapshot(manifest) }, signal?.signal ?? ctx.signal, 120000))
        }
      }
      return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, decode(child)]))
    }
    return value
  }
  const methods = new Set(['registerActionsItems', 'registerEditItems', 'registerCaseItems', 'registerFormatItems', 'registerToolbarItems', 'registerTools', 'getEditorInputValue', 'getEditorInputSelectedText', 'setEditorInputValue', 'replaceEditorInputSelection', 'setEditorInputFocus', 'toEditor', 'toast', 'toastText', 'log', 'callApiFunction'])
  const rpc = createPluginRpc({
    transport,
    onFailure,
    callHost: async (method, encoded) => {
      if (ctx.signal.aborted) throw new Error('Plugin is disposed')
      const args = decode(encoded) as unknown[]
      if (method === 'callback') {
        const callback = hostCallbacks.get(args[0] as number)
        if (!callback || !Array.isArray(args[1])) throw new Error('Unknown host callback')
        return encode(await callback(...args[1]))
      }
      if (!methods.has(method)) throw new Error('Unknown plugin host method')
      if (['setEditorInputValue', 'replaceEditorInputSelection', 'toEditor'].includes(method) && args[0] !== undefined && typeof args[0] !== 'string') throw new Error('Invalid editor argument')
      if (['toast', 'toastText'].includes(method) && (typeof args[0] !== 'string' || !['success', 'error', 'warn', 'info'].includes(String(args[1])))) throw new Error('Invalid notification arguments')
      if (method === 'log' && (!['info', 'warn', 'error', 'debug'].includes(String(args[0])) || typeof args[1] !== 'string')) throw new Error('Invalid log arguments')
      const fn = ctx[method as keyof PluginContext] as (...args: unknown[]) => unknown
      return encode(await fn(...args))
    },
  })
  const stop = () => rpc.abortPending()
  ctx.signal.addEventListener('abort', stop, { once: true })
  ctx.onDispose(async () => {
    ctx.signal.removeEventListener('abort', stop)
    try { await rpc.request('dispose', {}, undefined, 1500) } finally { rpc.close(); hostCallbacks.clear() }
  })
  try {
    await rpc.request('load', { manifest, url: convertFileSrc(modulePath, 'tyco-plugin') }, ctx.signal)
    await rpc.request('init', { config: ctx.getMyConfig(), messages: snapshot(manifest) }, ctx.signal)
  } catch (error) {
    rpc.close()
    throw error
  }
}
