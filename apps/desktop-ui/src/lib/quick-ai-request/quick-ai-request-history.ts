import type {
  EditorHistoryInputKind,
  EditorHistoryInstruction,
  EditorHistoryTurn,
} from '@tyco/shared'

/** A turn as the history sees it: only finished turns are stored */
export interface QuickAiRequestHistoryTurn {
  prompt: string
  inputKind: 'text' | 'voice'
  /** The first reply block, else the answer text */
  result?: string
}

export interface QuickAiRequestHistorySession {
  /** The text the request was made over; the first question when none */
  text: string
  profileId: string | null
  instruction: EditorHistoryInstruction
  turns: EditorHistoryTurn[]
}

export interface QuickAiRequestHistoryDependencies {
  /** Resolves to the id of the stored entry, null when nothing was stored */
  create: (session: QuickAiRequestHistorySession) => Promise<string | null>
  update: (
    id: string,
    turns: EditorHistoryTurn[],
    result: string | undefined
  ) => Promise<void>
}

const toInputKind = (kind: 'text' | 'voice'): EditorHistoryInputKind =>
  kind === 'voice' ? 'voice' : 'typed'

/**
 * Keeps one history entry per quick request session. The entry appears with the
 * first answer, so a cancelled or failed request leaves nothing behind. Writes
 * run one after another: an update never overtakes the creation it depends on
 */
export function createQuickAiRequestHistory(
  deps: QuickAiRequestHistoryDependencies
) {
  let sessionId: string | null = null
  let queue: Promise<void> = Promise.resolve()

  const write = async (
    sourceText: string | undefined,
    profileId: string | null,
    turns: readonly QuickAiRequestHistoryTurn[],
    result: string | undefined
  ) => {
    const stored = turns.filter((turn) => turn.result)
    if (!stored.length) return
    const historyTurns: EditorHistoryTurn[] = stored.map((turn) => ({
      prompt: turn.prompt,
      inputKind: toInputKind(turn.inputKind),
      ...(turn.result ? { result: turn.result } : {}),
    }))
    const finalResult = result ?? stored.at(-1)?.result

    if (!sessionId) {
      const first = stored[0]
      sessionId = await deps.create({
        text: sourceText?.trim() ? sourceText : first.prompt,
        profileId,
        instruction: {
          text: first.prompt,
          inputKind: toInputKind(first.inputKind),
        },
        turns: historyTurns,
      })
      if (!sessionId) return
    }
    await deps.update(sessionId, historyTurns, finalResult)
  }

  /**
   * Stores the finished turns; `result` is what the user took, the last answer
   * otherwise. Resolves when this and every earlier write are done; a failed
   * write is not retried and does not stop the later ones
   */
  const record = (
    sourceText: string | undefined,
    profileId: string | null,
    turns: readonly QuickAiRequestHistoryTurn[],
    result?: string
  ): Promise<void> => {
    const snapshot = turns.map((turn) => ({ ...turn }))
    queue = queue
      .then(() => write(sourceText, profileId, snapshot, result))
      .catch(() => undefined)
    return queue
  }

  return { record, sessionId: () => sessionId }
}
