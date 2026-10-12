import type { HistoryApi } from './history-call'
import { createEditorHistoryModel } from './editor-history'
import { createChatHistoryModel } from './chat-history'
export { HistoryOperationError, type HistoryApi } from './history-call'

export function createHistoryStoreModel(historyApi: HistoryApi) {
  return {
    ...createEditorHistoryModel(historyApi),
    ...createChatHistoryModel(historyApi),
  }
}
