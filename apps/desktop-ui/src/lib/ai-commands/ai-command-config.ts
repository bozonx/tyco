import {
  AI_COMMAND_MAX_STEPS_DEFAULT,
  AI_COMMAND_MAX_STEPS_MAX,
  type AiCommandOperationConfig,
  type CommandConfig,
  type CoreOperationId,
} from '@tyco/shared'

import { stringOr } from '../commands/command-config'

/** The tool of AI commands */
export const AI_COMMAND_OPERATION_ID = 'core.aiTask' satisfies CoreOperationId

export const isAiCommand = (command: Pick<CommandConfig, 'operationId'>) =>
  command.operationId === AI_COMMAND_OPERATION_ID

/** The step limit as a whole number within range, or the default */
export function maxStepsOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return AI_COMMAND_MAX_STEPS_DEFAULT
  const steps = Math.round(value)
  return steps >= 1
    ? Math.min(steps, AI_COMMAND_MAX_STEPS_MAX)
    : AI_COMMAND_MAX_STEPS_DEFAULT
}

/** The settings of an AI command as read from its `operationConfig` */
export function aiCommandOperationConfigOf(
  config: Record<string, unknown>
): AiCommandOperationConfig {
  const ids = Array.isArray(config.allowedCommandIds)
    ? config.allowedCommandIds.filter(
        (id): id is string => typeof id === 'string' && id.trim() !== ''
      )
    : []
  return {
    prompt: stringOr(config.prompt),
    allowedCommandIds: [...new Set(ids)],
    maxSteps: maxStepsOf(config.maxSteps),
    isToolsEnabled: config.isToolsEnabled !== false,
  }
}

/** The commands an AI command may let its agent run: any but itself */
export const callableCommands = (
  command: Pick<CommandConfig, 'id'>,
  commands: readonly CommandConfig[]
): CommandConfig[] => commands.filter((item) => item.id !== command.id)
