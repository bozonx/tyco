import {
  AI_COMMAND_MAX_STEPS_DEFAULT,
  AI_COMMAND_MAX_STEPS_MAX,
  type AiCommandToolConfig,
  type CommandConfig,
  type CoreToolId,
  type LauncherPageConfig,
  SHORTCUT_SLOT_KEYS,
} from '@tyco/shared'

import { createCommand, stringOr } from '../commands/command-config'
import {
  firstFreeSlotIndex,
  nameFromPrompt,
} from '../shortcut-slots/slot-prompt'

/** The tool of AI commands */
export const AI_COMMAND_TOOL_ID = 'core.aiTask' satisfies CoreToolId

/** The id of a request typed in the command overlay and run without saving */
export const AD_HOC_AI_COMMAND_ID = 'ad-hoc-ai-command'

export const isAiCommand = (command: Pick<CommandConfig, 'toolId'>) =>
  command.toolId === AI_COMMAND_TOOL_ID

/** The step limit as a whole number within range, or the default */
export function maxStepsOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return AI_COMMAND_MAX_STEPS_DEFAULT
  const steps = Math.round(value)
  return steps >= 1
    ? Math.min(steps, AI_COMMAND_MAX_STEPS_MAX)
    : AI_COMMAND_MAX_STEPS_DEFAULT
}

/** The settings of an AI command as read from its `toolConfig` */
export function aiCommandToolConfigOf(
  config: Record<string, unknown>
): AiCommandToolConfig {
  const ids = Array.isArray(config.allowedCommandIds)
    ? config.allowedCommandIds.filter(
        (id): id is string => typeof id === 'string' && id.trim() !== ''
      )
    : []
  return {
    prompt: stringOr(config.prompt),
    allowedCommandIds: [...new Set(ids)],
    maxSteps: maxStepsOf(config.maxSteps),
  }
}

/** The commands an AI command may let its agent run: any but itself */
export const callableCommands = (
  command: Pick<CommandConfig, 'id'>,
  commands: readonly CommandConfig[]
): CommandConfig[] => commands.filter((item) => item.id !== command.id)

/**
 * An AI command made from a request typed in the command overlay: named by its
 * first line, it replaces the selection like a new command of the tool does
 */
export function aiCommandFromPrompt(
  prompt: string,
  id?: string
): CommandConfig {
  const command = createCommand(AI_COMMAND_TOOL_ID, id, {
    defaultOutputAction: 'insertIntoWindow',
  })
  return {
    ...command,
    name: nameFromPrompt(prompt),
    toolConfig: { ...command.toolConfig, prompt: prompt.trim() },
  }
}

/**
 * A typed request run once, without saving: the result menu shows its output,
 * since such a command has nothing to hand a selection run over to
 */
export const adHocAiCommand = (prompt: string): CommandConfig => ({
  ...aiCommandFromPrompt(prompt, AD_HOC_AI_COMMAND_ID),
  outputAction: 'showMenu',
})

export interface SavedPrompt {
  commands: CommandConfig[]
  launcherPages: LauncherPageConfig[]
  /** False when an AI command with this prompt is in the library already */
  isAdded: boolean
}

/**
 * The library with a typed request saved as an AI command. A page that lays its
 * keys out gets it on its first free key; a page without a layout lists every
 * command anyway
 */
export function savePromptAsCommand(
  library: {
    commands: readonly CommandConfig[]
    launcherPages: readonly LauncherPageConfig[]
  },
  prompt: string,
  pageIndex: number,
  id?: string
): SavedPrompt {
  const commands = [...library.commands]
  const launcherPages = [...library.launcherPages]
  const text = prompt.trim()
  const isSaved = commands.some(
    (command) =>
      isAiCommand(command) &&
      aiCommandToolConfigOf(command.toolConfig).prompt.trim() === text
  )
  if (!text || isSaved) return { commands, launcherPages, isAdded: false }
  const command = aiCommandFromPrompt(text, id)
  commands.push(command)
  const page = launcherPages[pageIndex]
  if (page && Object.keys(page.slots).length) {
    const key = SHORTCUT_SLOT_KEYS[firstFreeSlotIndex(page.slots)]
    if (key)
      launcherPages[pageIndex] = {
        ...page,
        slots: { ...page.slots, [key]: command.id },
      }
  }
  return { commands, launcherPages, isAdded: true }
}
