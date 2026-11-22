import {
  MAX_TOOL_STEPS,
  type AiCommandOperationConfig,
  type CommandConfig,
  type CoreOperationId,
} from '@tyco/shared'

import { stringOr } from '../commands/command-config'

/** The tool of AI commands */
export const AI_COMMAND_OPERATION_ID = 'core.aiTask' satisfies CoreOperationId

export const isAiCommand = (command: Pick<CommandConfig, 'operationId'>) =>
  command.operationId === AI_COMMAND_OPERATION_ID

/**
 * The command's own step limit as a whole number within range; undefined when
 * it has none and takes `llm.maxToolSteps`
 */
export function maxStepsOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const steps = Math.round(value)
  return steps >= 1 ? Math.min(steps, MAX_TOOL_STEPS) : undefined
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
  const maxSteps = maxStepsOf(config.maxSteps)
  return {
    prompt: stringOr(config.prompt),
    allowedCommandIds: [...new Set(ids)],
    ...(maxSteps === undefined ? {} : { maxSteps }),
    isToolsEnabled: config.isToolsEnabled !== false,
  }
}

/** The commands an AI command may let its agent run: any but itself */
export const callableCommands = (
  command: Pick<CommandConfig, 'id'>,
  commands: readonly CommandConfig[]
): CommandConfig[] => commands.filter((item) => item.id !== command.id)
