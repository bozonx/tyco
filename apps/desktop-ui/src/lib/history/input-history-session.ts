import type {
  EditorHistoryEntry,
  EditorHistoryOperation,
  EditorHistoryOrigin,
} from '@tyco/shared'

/**
 * How often unfinished input reaches the history: a crash loses at most this
 * much of it. Dictated text cannot be repeated the same way, so it is short
 */
export const INPUT_HISTORY_INTERVAL_MS = 5_000

interface InputRecord {
  id?: string
  text: string
  kind: EditorHistoryEntry['kind']
  operation?: EditorHistoryOperation
  savedId: string | null
  savedText: string
  savedKind?: EditorHistoryEntry['kind']
  savedOperation?: EditorHistoryOperation
  ended: boolean
}

/**
 * Keeps failed records until they are saved, independently of input lifetime.
 *
 * Intentional: this is the only place user input is kept outside the input
 * itself. With the history turned off `save` stores nothing, and the input is
 * not kept anywhere else either, on disk or in memory: the user chose not to
 * keep it. Do not add a parallel draft store or a recall of the last input
 */
export function createInputHistorySession(deps: {
  save: (entry: EditorHistoryEntry) => Promise<string | null>
  /** Where the input is typed or dictated, for the history filter */
  origin?: EditorHistoryOrigin
  reportError: (error: unknown) => void
  onDrained?: () => void
}) {
  const createRecord = (): InputRecord => ({
    text: '',
    kind: 'draft',
    savedId: null,
    savedText: '',
    ended: false,
  })
  let current = createRecord()
  const records = new Set<InputRecord>()
  let pending = Promise.resolve<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelayMs = 1000
  let disposed = false
  let stopped = false

  const stopTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const isDirty = (record: InputRecord) =>
    Boolean(record.text.trim()) &&
    (record.text !== record.savedText ||
      record.kind !== record.savedKind ||
      record.operation !== record.savedOperation)

  const write = () => {
    const target = current
    const snapshots = [...records].map((record) => ({
      record,
      text: record.text,
      kind: record.kind,
      operation: record.operation,
    }))
    const next = pending
      .catch(() => null)
      .then(async () => {
        const failures: unknown[] = []
        for (const { record, text, kind, operation } of snapshots) {
          if (
            !text.trim() ||
            (text === record.savedText &&
              kind === record.savedKind &&
              operation === record.savedOperation)
          )
            continue
          try {
            const id = await deps.save({
              id: record.id,
              text,
              kind,
              operation,
              ...(deps.origin && { origin: deps.origin }),
            })
            // null is intentional: history is disabled or the record was deleted.
            if (id) record.id = id
            record.savedId = id
            record.savedText = text
            record.savedKind = kind
            record.savedOperation = operation
          } catch (error) {
            failures.push(error)
          }
        }
        for (const record of records) {
          if (record.ended && !isDirty(record)) records.delete(record)
        }
        if (failures.length) {
          if (!stopped && !retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined
              void write().catch(deps.reportError)
            }, retryDelayMs)
            retryDelayMs = Math.min(retryDelayMs * 2, 30_000)
          }
          throw failures[0]
        }
        clearTimeout(retryTimer)
        retryTimer = undefined
        retryDelayMs = 1000
        if (disposed && records.size === 0) deps.onDrained?.()
        return target.savedId
      })
    pending = next
    return next
  }
  const flush = () => {
    stopTimer()
    return write()
  }
  const checkpoint = () => {
    void flush().catch(deps.reportError)
  }
  const update = (text: string) => {
    if (disposed) return
    if (current.ended) current = createRecord()
    current.text = text
    records.add(current)
    if (!timer && isDirty(current))
      timer = setTimeout(checkpoint, INPUT_HISTORY_INTERVAL_MS)
  }
  const complete = (
    text: string,
    kind: 'source' | 'output',
    operation?: EditorHistoryOperation
  ) => {
    stopTimer()
    current.text = text
    current.kind = kind
    current.operation = operation
    current.ended = true
    records.add(current)
    return write()
  }
  const end = () => {
    current.ended = true
    checkpoint()
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    end()
  }
  const stop = () => {
    stopped = true
    stopTimer()
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  return { update, flush, checkpoint, complete, end, dispose, stop }
}
