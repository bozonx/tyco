/** Stores a draft; resolves to its id, or null when nothing was stored. */
export type SaveDraft = (
  text: string,
  replaceId?: string
) => Promise<string | null>

/**
 * Keeps one history entry per editing session of an input. Every snapshot of
 * the same session replaces the previous one, so hiding the window again and
 * again after small edits does not fill the history with near copies. The
 * session ends when its text leaves the input (cleared or replaced)
 */
/** Removes a stored draft by its id. */
export type RemoveDraft = (id: string) => Promise<unknown>

export function createDraftSession(
  saveDraft: SaveDraft,
  removeDraft?: RemoveDraft
) {
  let draftId: string | null = null
  let savedText = ''
  let queue: Promise<void> = Promise.resolve()

  // saves run one after another: each one needs the id of the previous one
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch(() => {})

    return queue
  }

  const save = async (text: string): Promise<void> => {
    if (!text.trim() || text === savedText) return

    draftId = await saveDraft(text, draftId ?? undefined)
    savedText = text
  }

  /** Saves the text as the current draft of the session. */
  const snapshot = (text: string): Promise<void> => enqueue(() => save(text))

  /** Saves the text a last time and starts a new session. */
  const end = (text: string): Promise<void> =>
    enqueue(async () => {
      await save(text)
      draftId = null
      savedText = ''
    })

  /**
   * Drops the session without a trace: the draft it already stored is removed
   * from the history. A new session starts
   */
  const discard = (): Promise<void> =>
    enqueue(async () => {
      const id = draftId
      draftId = null
      savedText = ''
      if (id) await removeDraft?.(id)
    })

  return { snapshot, end, discard }
}
