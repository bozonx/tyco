import type { OperationCall, OperationCallCommand } from '@tyco/plugin-sdk'

/** Whether the caller uses the output. */
export const outputRequest = (
  isOutputRequested: boolean
): Pick<OperationCall, 'isOutputRequested'> => ({ isOutputRequested })

/** The command a tool runs for. */
export const operationCallCommand = (
  id: string,
  name: string,
  isOutputLogged: boolean
): OperationCallCommand => ({ id, name, isOutputLogged })
