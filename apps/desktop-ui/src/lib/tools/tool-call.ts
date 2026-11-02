import type { ToolCall, ToolCallCommand } from '@tyco/plugin-sdk'

/** Whether the caller uses the output. */
export const outputRequest = (
  isOutputRequested: boolean
): Pick<ToolCall, 'isOutputRequested'> => ({ isOutputRequested })

/** The command a tool runs for. */
export const toolCallCommand = (
  id: string,
  name: string,
  isOutputLogged: boolean
): ToolCallCommand => ({ id, name, isOutputLogged })
