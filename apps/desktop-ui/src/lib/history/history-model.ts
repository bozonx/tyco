import type { EditorHistoryOrigin } from '@tyco/shared'

import { createInputHistorySession } from './input-history-session'
import type { HistoryApi } from './history-call'
import { createEditorHistoryModel } from './editor-history'
import { createChatHistoryModel } from './chat-history'
export type { HistoryApi } from './history-call'

export function createHistoryModel(
  historyApi: HistoryApi,
  reportError: (error: unknown) => void,
  canRecordEditorHistory?: () => boolean
) {
  const inputFlushes = new Set<() => Promise<unknown>>()
  const editor = createEditorHistoryModel(historyApi, canRecordEditorHistory)
  const sessions = new Set<ReturnType<typeof createInputHistorySession>>()
  return {
    createInputSession: (
      reportSaveError: (error: unknown) => void,
      origin?: EditorHistoryOrigin
    ) => {
      const session = createInputHistorySession({
        save: editor.saveEditorHistory,
        origin,
        reportError: reportSaveError,
        onDrained: () => {
          sessions.delete(session)
          inputFlushes.delete(session.flush)
          session.stop()
        },
      })
      sessions.add(session)
      inputFlushes.add(session.flush)
      return session
    },
    dispose: () => {
      for (const session of sessions) session.stop()
      sessions.clear()
      inputFlushes.clear()
    },
    registerInputFlush: (flush: () => Promise<unknown>) => {
      inputFlushes.add(flush)
      return () => {
        inputFlushes.delete(flush)
      }
    },
    flushInputs: async () => {
      const results = await Promise.allSettled(
        [...inputFlushes].map((flush) => flush())
      )
      return results.every((result) => result.status === 'fulfilled')
    },
    ...editor,
    ...createChatHistoryModel(historyApi, reportError),
  }
}
