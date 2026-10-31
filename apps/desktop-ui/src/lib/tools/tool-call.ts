import type { ToolCall, ToolCallCommand } from '@tyco/plugin-sdk'

/**
 * Whether the caller uses the output, with the deprecated alias that plugins
 * built before `isOutputRequested` read
 */
export const outputRequest = (
  isOutputRequested: boolean
): Pick<ToolCall, 'isOutputRequested' | 'wantsOutput'> => ({
  isOutputRequested,
  wantsOutput: isOutputRequested,
})

/**
 * The command a tool runs for, with the deprecated alias that plugins built
 * before `isOutputLogged` read
 */
export const toolCallCommand = (
  id: string,
  name: string,
  isOutputLogged: boolean
): ToolCallCommand => ({ id, name, isOutputLogged, logOutput: isOutputLogged })
