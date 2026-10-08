// This module is served with a separate CSP: no connections, eval or child workers.
const send = globalThis.postMessage.bind(globalThis)
const pending = new Map()
const callbacks = new Map()
const controllers = new Map()
const controller = new AbortController()
const cleanups = []
const effects = new Set()
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
    const id = ++sequence
    pending.set(id, { resolve, reject })
    send({
      type: 'host',
      id,
      requestId: currentRequest,
      method,
      args: encode(args),
    })
  })
const effect = (method, args) => {
  const promise = rpc(method, args)
  effects.add(promise)
  // Preserve rejection for flush(), without an unhandled rejection in the worker.
  void promise.catch(() => {})
}
async function flush() {
  const batch = [...effects]
  effects.clear()
  await Promise.all(batch)
}
function encode(value) {
  if (typeof value === 'function') {
    const id = ++sequence
    callbacks.set(id, value)
    return { $callback: id }
  }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encode(entry)])
    )
  return value
}
function decode(value) {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    if (typeof value.$callback === 'number')
      return (...args) => rpc('callback', [value.$callback, args])
    if (typeof value.$date === 'string') return new Date(value.$date)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decode(entry)])
    )
  }
  return value
}
function check(capability) {
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
    : key
}
const context = {
  signal: controller.signal,
  onDispose: (cleanup) => {
    check()
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
  callApiFunction: (name, args) => {
    check()
    return rpc('callApiFunction', [name, args])
  },
}
for (const method of [
  'registerActionsItems',
  'registerEditItems',
  'registerCaseItems',
  'registerFormatItems',
  'registerToolbarItems',
  'registerTools',
  'setEditorInputValue',
  'replaceEditorInputSelection',
  'setEditorInputFocus',
  'toEditor',
  'toast',
  'toastText',
  'log',
]) {
  context[method] = (...args) => {
    check()
    effect(method, args)
  }
}

globalThis.onmessage = async ({ data }) => {
  if (data?.type === 'host-result') {
    const task = pending.get(data.id)
    if (!task) return
    pending.delete(data.id)
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
  queue = queue.then(async () => {
    currentRequest = data.id
    try {
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
        if (cleanup) cleanups.push(cleanup)
        await flush()
      } else if (data.method === 'invoke') {
        dictionaries = data.args.messages
        const callback = callbacks.get(data.args.callback)
        if (!callback) throw new Error('Unknown plugin callback')
        const args = decode(data.args.args)
        const invocation = new AbortController()
        controllers.set(data.id, invocation)
        for (const arg of args)
          if (arg && typeof arg === 'object' && arg.$signal === true) {
            delete arg.$signal
            arg.signal = invocation.signal
          }
        result = await callback(...args)
        await flush()
        controllers.delete(data.id)
      } else if (data.method === 'dispose') {
        controller.abort()
        for (const invocation of controllers.values()) invocation.abort()
        for (const cleanup of cleanups.reverse()) await cleanup()
      } else throw new Error('Unknown runtime request')
      send({ type: 'result', id: data.id, result: encode(result) })
    } catch (error) {
      controllers.delete(data.id)
      send({ type: 'result', id: data.id, error: errorData(error) })
    }
  })
}
