import type { DesktopCommandName, DesktopCommandResult } from '@tyco/shared'
import type { DesktopCall, DesktopCallParams } from '../ipc/ipc-model'

export interface HistoryApi {
  call: DesktopCall
}
class HistoryOperationError extends Error {
  constructor(operation: string, message?: string) {
    super(message || `History operation failed: ${operation}`)
    this.name = 'HistoryOperationError'
  }
}

/** Calls a history command, throwing on a failure */
export function createHistoryCall(historyApi: HistoryApi) {
  const call = async <K extends DesktopCommandName>(
    command: K,
    ...args: DesktopCallParams<K>
  ): Promise<DesktopCommandResult<K> | undefined> => {
    const response = await historyApi.call(command, ...args)

    if (response.success === false) {
      throw new HistoryOperationError(command, response.error)
    }

    return response.result
  }
  return call
}
