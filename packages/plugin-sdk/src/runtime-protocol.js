/** Shared wire format used by the host and the isolated worker. */
export const PLUGIN_RPC_LIMITS = Object.freeze({
  messageBytes: 8 * 1024 * 1024,
  depth: 32,
  entries: 100000,
  pendingRequests: 64,
  callbacks: 4096,
  cancellationGraceMs: 1500,
  hostTimeoutMs: 10000,
})

/**
 * @param {unknown} value
 * @param {(callback: (...args: unknown[]) => unknown) => number} registerCallback
 * @returns {unknown}
 */
export function encodePluginValue(value, registerCallback) {
  let entries = 0
  const visit = (value, depth) => {
    if (
      ++entries > PLUGIN_RPC_LIMITS.entries ||
      depth > PLUGIN_RPC_LIMITS.depth
    )
      throw new Error('Plugin value exceeds the complexity limit')
    if (typeof value === 'function')
      return { $callback: registerCallback(value) }
    if (value instanceof Date) return { $date: value.toISOString() }
    if (value instanceof AbortSignal) return undefined
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, depth + 1))
    if (value && typeof value === 'object') {
      const pairs = Object.entries(value).map(([key, entry]) => [
        key,
        visit(entry, depth + 1),
      ])
      return ['$callback', '$date', '$object'].some((key) =>
        Object.hasOwn(value, key)
      )
        ? { $object: pairs }
        : Object.fromEntries(pairs)
    }
    return value
  }
  const encoded = visit(value, 0)
  assertPluginMessage(encoded)
  return encoded
}

/**
 * @param {unknown} value
 * @param {(id: number) => (...args: unknown[]) => unknown} callback
 * @returns {unknown}
 */
export function decodePluginValue(value, callback) {
  assertPluginMessage(value)
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1) {
        if (Array.isArray(value.$object)) {
          if (
            !value.$object.every(
              (pair) =>
                Array.isArray(pair) &&
                pair.length === 2 &&
                typeof pair[0] === 'string'
            )
          )
            throw new Error('Invalid escaped plugin object')
          return Object.fromEntries(
            value.$object.map(([key, entry]) => [key, visit(entry)])
          )
        }
        if (Number.isSafeInteger(value.$callback) && value.$callback > 0)
          return callback(value.$callback)
        if (typeof value.$date === 'string') {
          const date = new Date(value.$date)
          if (!Number.isFinite(date.getTime()))
            throw new Error('Invalid plugin date')
          return date
        }
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry)])
      )
    }
    return value
  }
  return visit(value)
}

/** @param {unknown} value */
export function assertPluginMessage(value) {
  let entries = 0
  const visit = (value, depth) => {
    if (
      ++entries > PLUGIN_RPC_LIMITS.entries ||
      depth > PLUGIN_RPC_LIMITS.depth
    )
      throw new Error('Plugin message exceeds the complexity limit')
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Invalid plugin number')
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) visit(entry, depth + 1)
    } else if (
      value !== null &&
      !['string', 'number', 'boolean', 'undefined'].includes(typeof value)
    ) {
      throw new Error('Invalid plugin message value')
    }
  }
  visit(value, 0)
  if (
    new TextEncoder().encode(JSON.stringify(value) ?? '').length >
    PLUGIN_RPC_LIMITS.messageBytes
  )
    throw new Error('Plugin message exceeds the size limit')
}

/** Host effects have void SDK signatures; the worker flushes them per operation. */
export const PLUGIN_EFFECT_METHODS = Object.freeze([
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
])
export const PLUGIN_HOST_METHODS = Object.freeze([
  ...PLUGIN_EFFECT_METHODS,
  'getEditorInputValue',
  'getEditorInputSelectedText',
  'getEditorInputSnapshot',
  'applyEditorInputEdit',
  'callApiFunction',
])
