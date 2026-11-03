import type { EditorHistoryEntry, EditorHistoryOperation } from '@tyco/shared'

export const INPUT_HISTORY_INTERVAL_MS = 10_000

/** Serializes checkpoints and promotes the same record when input is submitted. */
export function createInputHistorySession(deps: {
  save: (entry: EditorHistoryEntry) => Promise<string | null>
  reportError: (error: unknown) => void
}) {
  let current = {
    id: undefined as string | undefined,
    text: '',
    saved: '',
    ended: false,
  }
  let pending = Promise.resolve<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  const stopTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const write = (
    kind: EditorHistoryEntry['kind'],
    operation?: EditorHistoryOperation
  ) => {
    const session = current
    const text = session.text
    const next = pending
      .catch(() => null)
      .then(async () => {
        if (!text.trim() || (kind === 'draft' && text === session.saved))
          return session.id ?? null
        const id = await deps.save({ id: session.id, text, kind, operation })
        if (id) {
          session.id = id
          session.saved = text
        }
        return id
      })
    pending = next
    return next
  }
  const flush = () => {
    stopTimer()
    return current.ended ? pending : write('draft')
  }
  const checkpoint = () => {
    void flush().catch(deps.reportError)
  }
  const update = (text: string) => {
    if (current.ended)
      current = { id: undefined, text: '', saved: '', ended: false }
    current.text = text
    if (!timer && text !== current.saved) {
      timer = setTimeout(checkpoint, INPUT_HISTORY_INTERVAL_MS)
    }
  }
  const complete = (
    text: string,
    kind: 'source' | 'output',
    operation?: EditorHistoryOperation
  ) => {
    stopTimer()
    current.text = text
    const result = write(kind, operation)
    current.ended = true
    return result
  }
  const end = () => {
    checkpoint()
    current.ended = true
  }
  const dispose = () => {
    end()
    stopTimer()
  }
  return { update, flush, checkpoint, complete, end, dispose }
}
