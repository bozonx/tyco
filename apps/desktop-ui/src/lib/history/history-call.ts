import type {
  DesktopCall,
  DesktopCallArgs,
  DesktopFunctionName,
  DesktopFunctionResult,
} from '../ipc/desktop-functions'

export interface HistoryApi {
  callFunction: DesktopCall
}
export class HistoryOperationError extends Error {
  constructor(operation: string, message?: string) {
    super(message || `History operation failed: ${operation}`)
    this.name = 'HistoryOperationError'
  }
}

export function createHistoryCall(historyApi: HistoryApi) {
  const call = async <K extends DesktopFunctionName>(
    functionName: K,
    ...args: DesktopCallArgs<K>
  ): Promise<DesktopFunctionResult<K> | undefined> => {
    const response = await historyApi.callFunction(functionName, ...args)

    if (response.success === false) {
      throw new HistoryOperationError(functionName, response.error)
    }

    return response.result
  }
  return call
}
