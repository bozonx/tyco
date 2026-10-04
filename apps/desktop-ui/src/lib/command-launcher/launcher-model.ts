import { computed, ref, shallowRef } from 'vue'

import type { CommandConfig, CommandRunRecord } from '@tyco/shared'

import {
  commandLabel,
  commandTakesText,
  isKnownTool,
} from '../commands/command-config'
import type { CommandRunOutcome } from '../commands/command-runner'
import { moveHighlight } from '../menu-query/menu-query'

/** The first commands of the list are run with the keys `1`–`9` */
export const LAUNCHER_KEY_COUNT = 9

/**
 * What the overlay shows:
 *
 * - `list` — the commands, with the search;
 * - `prepare` — one command before it runs: the text it takes, typed or taken
 *   from the selection, or a confirmation for a command that asks for one;
 * - `running` — the command is on its way.
 */
export type LauncherStage =
  | { kind: 'list' }
  | { kind: 'prepare'; command: CommandConfig }
  | { kind: 'running'; command: CommandConfig }

/** Whether the overlay offers the command */
export function isLauncherCommand(command: CommandConfig): boolean {
  return command.enabled && command.availableIn.launcher && isKnownTool(command)
}

const normalize = (text: string): string =>
  text
    .toLocaleLowerCase()
    .replace(/ё/g, 'е')
    // the phrase syntax: `(a|b)` alternatives and `[optional]` words
    .replace(/[()[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const words = (text: string): string[] => text.split(' ').filter(Boolean)

/**
 * How well the command matches the normalized `needle`, lower is better, or
 * `null` when it does not: the name starts with it, then a word of the name or
 * of a phrase does, then the name, a phrase or the description contains it
 */
function matchRank(command: CommandConfig, needle: string): number | null {
  const name = normalize(commandLabel(command))
  const phrases = command.phrases.map(normalize)
  if (name.startsWith(needle)) return 0
  if (
    [name, ...phrases].some((text) =>
      words(text).some((word) => word.startsWith(needle))
    )
  ) {
    return 1
  }
  const description = normalize(command.description ?? '')
  if ([name, ...phrases, description].some((text) => text.includes(needle))) {
    return 2
  }
  return null
}

/** The commands matching `query`, the best first, otherwise in their order */
export function searchCommands(
  commands: readonly CommandConfig[],
  query: string
): CommandConfig[] {
  const needle = normalize(query)
  if (!needle) return [...commands]
  return commands
    .map((command) => ({ command, rank: matchRank(command, needle) }))
    .filter(
      (item): item is { command: CommandConfig; rank: number } =>
        item.rank !== null
    )
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.command)
}

export interface CommandLauncherDependencies {
  /** The command library, in the order the user gave it */
  commands: () => readonly CommandConfig[] | undefined
  /** The text selected in the window the overlay was opened over */
  selectedText: () => string | null | undefined
  /** Runs the command and tells the user how it went */
  run: (command: CommandConfig, text: string) => Promise<CommandRunOutcome>
  /** Records a text that leaves the app with a command */
  saveOutput?: (text: string) => Promise<void>
  logRun?: (record: CommandRunRecord) => Promise<void> | void
}

/** The command overlay opened from the keyboard: list, search, keys, input */
export function createCommandLauncherModel(deps: CommandLauncherDependencies) {
  const query = ref('')
  const highlighted = ref(0)
  const stage = shallowRef<LauncherStage>({ kind: 'list' })
  /** The text the prepared command gets */
  const text = ref('')
  /** The user changed the text, so a selection arriving late keeps off it */
  let textEdited = false

  const commands = computed(() =>
    (deps.commands() ?? []).filter(isLauncherCommand)
  )
  const visible = computed(() => searchCommands(commands.value, query.value))

  const reset = () => {
    query.value = ''
    highlighted.value = 0
    text.value = ''
    textEdited = false
    stage.value = { kind: 'list' }
  }

  const setQuery = (value: string) => {
    query.value = value
    highlighted.value = 0
  }

  const move = (delta: number) => {
    highlighted.value = moveHighlight(
      highlighted.value,
      delta,
      visible.value.length
    )
  }

  const log = (
    command: CommandConfig,
    input: string | null,
    outcome: CommandRunOutcome
  ) => {
    const record: CommandRunRecord = {
      commandId: command.id,
      name: commandLabel(command),
      source: 'launcher',
      success: outcome.success,
    }
    if (input !== null) record.text = input
    if (outcome.message) record.message = outcome.message
    void Promise.resolve(deps.logRun?.(record)).catch(() => {})
  }

  const execute = async (
    command: CommandConfig,
    input: string | null
  ): Promise<CommandRunOutcome> => {
    const running: LauncherStage = { kind: 'running', command }
    stage.value = running
    if (input !== null) {
      // the history keeps the text even when the command fails
      await deps.saveOutput?.(input).catch(() => {})
    }
    let outcome: CommandRunOutcome
    try {
      outcome = await deps.run(command, input ?? '')
    } catch (error) {
      outcome = {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    log(command, input, outcome)
    // a new activation started over meanwhile
    if (stage.value !== running) return outcome
    if (outcome.success) {
      reset()
    } else if (input !== null) {
      // the text stays for another try
      text.value = input
      stage.value = { kind: 'prepare', command }
    } else {
      stage.value = { kind: 'list' }
    }
    return outcome
  }

  /**
   * Runs the command, or first asks for its text when there is no selection, or
   * for a confirmation when the command wants one
   */
  const pick = async (command: CommandConfig): Promise<void> => {
    if (stage.value.kind === 'running') return
    const takesText = commandTakesText(command)
    const selection = takesText ? (deps.selectedText() ?? '') : ''
    if ((takesText && !selection.trim()) || command.confirm === 'always') {
      text.value = selection
      textEdited = false
      stage.value = { kind: 'prepare', command }
      return
    }
    await execute(command, takesText ? selection : null)
  }

  const pickHighlighted = () => {
    const command = visible.value[highlighted.value]
    return command ? pick(command) : Promise.resolve()
  }

  /** `1`–`9`: the command at that place of the list */
  const pickByKey = (key: number) => {
    const command =
      key >= 1 && key <= LAUNCHER_KEY_COUNT ? visible.value[key - 1] : undefined
    return command ? pick(command) : Promise.resolve()
  }

  const setText = (value: string) => {
    text.value = value
    textEdited = true
  }

  /** The prepared command can run: it has the text it needs */
  const canSubmit = computed(() => {
    const current = stage.value
    if (current.kind !== 'prepare') return false
    return !commandTakesText(current.command) || Boolean(text.value.trim())
  })

  const submit = async (): Promise<void> => {
    const current = stage.value
    if (current.kind !== 'prepare' || !canSubmit.value) return
    await execute(
      current.command,
      commandTakesText(current.command) ? text.value : null
    )
  }

  /** Esc: from a prepared command back to the list; `false` at the list */
  const back = (): boolean => {
    if (stage.value.kind !== 'prepare') return false
    stage.value = { kind: 'list' }
    return true
  }

  /**
   * The selection is captured after the overlay opens: if it comes while the
   * user is asked for the text and has typed nothing, it becomes the text
   */
  const selectionArrived = (selection: string | null | undefined) => {
    const current = stage.value
    if (
      current.kind === 'prepare' &&
      commandTakesText(current.command) &&
      !textEdited &&
      !text.value.trim() &&
      selection?.trim()
    ) {
      text.value = selection
    }
  }

  return {
    query,
    highlighted,
    stage,
    text,
    commands,
    visible,
    canSubmit,
    reset,
    setQuery,
    move,
    pick,
    pickHighlighted,
    pickByKey,
    setText,
    submit,
    back,
    selectionArrived,
  }
}

export type CommandLauncherModel = ReturnType<typeof createCommandLauncherModel>
