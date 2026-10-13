import {
  assertPluginMessage,
  encodePluginValue,
  decodePluginValue,
  PLUGIN_RPC_LIMITS,
  PLUGIN_EFFECT_METHODS,
} from './protocol.js'

// This module is served with a separate CSP: no connections, eval or child workers.
const send = globalThis.postMessage.bind(globalThis)
const pending = new Map()
const callbacks = new Map()
const controllers = new Map()
const controller = new AbortController()
const cleanups = []
let initialized = false
let sequence = 0
let config = {}
let dictionaries = {}
let capabilities = []
let init
let currentRequest
let queue = Promise.resolve()

const errorData = (error) => ({
  message: error?.message ?? String(error),
  code: error?.code,
  messageKey: error?.messageKey,
})
const rpc = (method, args) =>
  new Promise((resolve, reject) => {
    const encoded = encode(args)
    const id = ++sequence
    if (pending.size >= PLUGIN_RPC_LIMITS.pendingRequests) {
      reject(new Error('Too many plugin host requests'))
      return
    }
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Plugin host request timed out'))
    }, PLUGIN_RPC_LIMITS.hostTimeoutMs)
    pending.set(id, { resolve, reject, timer })
    send({
      type: 'host',
      id,
      requestId: currentRequest?.id,
      method,
      args: encoded,
    })
  })
const effect = (method, args) => {
  const promise = rpc(method, args)
  currentRequest?.effects.add(promise)
  void promise.catch(() => {})
}
async function flush(request) {
  while (request.effects.size) {
    const batch = [...request.effects]
    request.effects.clear()
    await Promise.all(batch)
  }
}
const encode = (value) =>
  encodePluginValue(value, (callback) => {
    if (callbacks.size >= PLUGIN_RPC_LIMITS.callbacks)
      throw new Error('Too many plugin callbacks')
    const id = ++sequence
    callbacks.set(id, callback)
    return id
  })
const decode = (value) =>
  decodePluginValue(
    value,
    (id) =>
      (...args) =>
        rpc('callback', [id, args])
  )
function check(capability) {
  if (!initialized && !currentRequest)
    throw new Error('Plugin is not initialized')
  if (controller.signal.aborted) throw new Error('Plugin is disposed')
  if (capability && !capabilities.includes(capability))
    throw new Error(`Plugin requires ${capability}`)
}
function t(key, params = {}) {
  const message = key
    .split('.')
    .reduce((value, part) => value?.[part], dictionaries)
  return typeof message === 'string'
    ? message.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
        String(params[name] ?? match)
      )
    : (() => {
        throw new Error(`Missing plugin translation: ${key}`)
      })()
}
const context = {
  signal: controller.signal,
  onDispose: (cleanup) => {
    check()
    if (typeof cleanup !== 'function' || cleanups.length >= 64)
      throw new Error('Invalid plugin cleanup handler')
    cleanups.push(cleanup)
  },
  getMyConfig: () => {
    check()
    return structuredClone(config)
  },
  t: (key, params) => {
    check()
    return t(key, params)
  },
  getEditorInputValue: () => {
    check('editor')
    return rpc('getEditorInputValue', [])
  },
  getEditorInputSelectedText: () => {
    check('editor')
    return rpc('getEditorInputSelectedText', [])
  },
  getEditorInputSnapshot: () => {
    check('editor')
    return rpc('getEditorInputSnapshot', [])
  },
  applyEditorInputEdit: (snapshot, value, scope) => {
    check('editor')
    return rpc('applyEditorInputEdit', [snapshot, value, scope])
  },
  callApiFunction: (name, args) => {
    check()
    return rpc('callApiFunction', [name, args])
  },
}
for (const method of PLUGIN_EFFECT_METHODS) {
  context[method] = (...args) => {
    check()
    effect(method, args)
  }
}

globalThis.onmessage = async ({ data }) => {
  try {
    assertPluginMessage(data)
  } catch (error) {
    send({ type: 'fatal', error: errorData(error) })
    return
  }
  if (data?.type === 'messages') {
    dictionaries = data.messages
    return
  }
  if (data?.type === 'host-result') {
    const task = pending.get(data.id)
    if (!task) return
    pending.delete(data.id)
    clearTimeout(task.timer)
    if (data.error)
      task.reject(Object.assign(new Error(data.error.message), data.error))
    else task.resolve(decode(data.result))
    return
  }
  if (data?.type === 'abort') {
    controller.abort()
    for (const invocation of controllers.values()) invocation.abort()
    return
  }
  if (data?.type === 'cancel') {
    controllers.get(data.id)?.abort()
    return
  }
  if (data?.type !== 'request' || !Number.isSafeInteger(data.id)) return
  if (controllers.size >= PLUGIN_RPC_LIMITS.pendingRequests) {
    send({ type: 'fatal', error: { message: 'Too many plugin invocations' } })
    return
  }
  const invocation =
    data.method === 'invoke' ? new AbortController() : undefined
  if (invocation) controllers.set(data.id, invocation)
  queue = queue.then(async () => {
    const request = { id: data.id, effects: new Set() }
    currentRequest = request
    try {
      if (invocation?.signal.aborted)
        throw Object.assign(new Error('Plugin request cancelled'), {
          code: 'tyco-plugin-cancelled',
        })
      let result
      if (data.method === 'load') {
        const args = data.args
        capabilities = args.manifest.capabilities
        const module = await import(args.url)
        if (typeof module.default !== 'function')
          throw new Error('Plugin must export a factory')
        const definition = module.default()
        const { init: activation, ...manifest } = definition
        if (JSON.stringify(manifest) !== JSON.stringify(args.manifest)) {
          // Property order is not part of the package contract.
          const canonical = (value) =>
            Array.isArray(value)
              ? value.map(canonical)
              : value && typeof value === 'object'
                ? Object.fromEntries(
                    Object.keys(value)
                      .sort()
                      .map((key) => [key, canonical(value[key])])
                  )
                : value
          if (
            JSON.stringify(canonical(manifest)) !==
            JSON.stringify(canonical(args.manifest))
          )
            throw new Error('Plugin definition does not match its manifest')
        }
        if (typeof activation !== 'function')
          throw new Error('Invalid plugin activation')
        init = activation
      } else if (data.method === 'init') {
        config = data.args.config
        dictionaries = data.args.messages
        const cleanup = await init(context)
        if (cleanup) context.onDispose(cleanup)
        await flush(request)
        initialized = true
      } else if (data.method === 'invoke') {
        dictionaries = data.args.messages
        const callback = callbacks.get(data.args.callback)
        if (!callback) throw new Error('Unknown plugin callback')
        const args = decode(data.args.args)
        for (const arg of args)
          if (arg && typeof arg === 'object' && arg.$signal === true) {
            delete arg.$signal
            arg.signal = invocation.signal
          }
        result = await callback(...args)
        await flush(request)
        controllers.delete(data.id)
      } else if (data.method === 'dispose') {
        controller.abort()
        for (const invocation of controllers.values()) invocation.abort()
        for (const cleanup of cleanups.reverse()) {
          try {
            await cleanup()
          } catch (error) {
            send({ type: 'cleanup-error', error: errorData(error) })
          }
        }
      } else throw new Error('Unknown runtime request')
      send({ type: 'result', id: data.id, result: encode(result) })
    } catch (error) {
      controllers.delete(data.id)
      send({ type: 'result', id: data.id, error: errorData(error) })
    } finally {
      currentRequest = undefined
    }
  })
}
