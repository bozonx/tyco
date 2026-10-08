import { computed, ref, shallowRef } from 'vue'

import type {
  CommandConfig,
  CommandRunRecord,
  CommandRunSource,
  LauncherRequest,
} from '@tyco/shared'

import {
  commandLabel,
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-config'
import type {
  CommandRunOptions,
  CommandRunOutcome,
} from '../commands/command-runner'
import { moveHighlight } from '../menu-query/menu-query'
import type { ToolLookup } from '../tools/tool-types'

/** The first commands of the list are run with the keys `1`–`9` */
export const LAUNCHER_KEY_COUNT = 9

/**
 * What the overlay shows:
 *
 * - `list` — the commands, with the search;
 * - `prepare` — one command before it runs: the text it takes, typed or taken
 *   from the selection, or a confirmation for a command that asks for one.
 *   `autoRun`: no confirmation is needed, so the command runs as soon as the
 *   selection comes;
 * - `running` — the command is on its way.
 */
export type LauncherStage =
  | { kind: 'list' }
  | { kind: 'prepare'; command: CommandConfig; autoRun: boolean }
  | { kind: 'running'; command: CommandConfig }

/** Whether the overlay offers the command */
export function isLauncherCommand(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return command.enabled && isCommandAvailable(command, tools)
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
  /** The tools the commands run */
  tools: ToolLookup
  claimJob?: (id: string) => Promise<boolean>
  finishJob?: (
    id: string,
    outcome: CommandRunOutcome
  ) => Promise<CommandRunOutcome | void>
  /** The command library, in the order the user gave it */
  commands: () => readonly CommandConfig[] | undefined
  /** The 15 slots of the command overlay */
  launcherCommands?: () => readonly (string | null)[] | undefined
  /** The text selected in the window the overlay was opened over */
  selectedText: () => string | null | undefined
  /** Runs the command and tells the user how it went */
  run: (
    command: CommandConfig,
    text: string,
    options?: CommandRunOptions
  ) => Promise<CommandRunOutcome>
  /**
   * Hands a command whose output replaces the selection over to a selection
   * run: the overlay hides, and the selection is replaced where it is
   */
  replaceSelection?: (command: CommandConfig) => Promise<void>
  /** Tells that a command of an external call is gone from the library */
  commandMissing?: (commandId: string) => void
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
  /** The text is the selection of the window under the overlay */
  let fromSelection = false
  /** Where the current command came from: the list or an external call */
  let source: CommandRunSource = 'launcher'
  let controller: AbortController | null = null
  let externalCall: LauncherRequest | null = null

  const commands = computed(() =>
    (deps.commands() ?? []).filter((command) =>
      isLauncherCommand(command, deps.tools)
    )
  )
  const visible = computed(() => searchCommands(commands.value, query.value))

  const slotCommands = computed<(CommandConfig | null)[]>(() => {
    const rawSlots = deps.launcherCommands?.()
    const all = deps.commands() ?? []
    if (rawSlots && rawSlots.length > 0) {
      return Array.from({ length: 15 }, (_, index) => {
        const id = rawSlots[index]
        if (!id) return null
        return all.find((cmd) => cmd.id === id) ?? null
      })
    }
    return Array.from(
      { length: 15 },
      (_, index) => commands.value[index] ?? null
    )
  })

  const pickSlot = (index: number) => {
    const command = slotCommands.value[index]
    return command && isLauncherCommand(command, deps.tools)
      ? pick(command)
      : Promise.resolve()
  }

  const reset = () => {
    if (externalCall?.jobId)
      void deps.finishJob?.(externalCall.jobId, {
        success: false,
        cancelled: true,
        message: 'Cancelled',
      })
    externalCall = null
    controller?.abort()
    controller = null
    source = 'launcher'
    query.value = ''
    highlighted.value = 0
    text.value = ''
    textEdited = false
    fromSelection = false
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
      source,
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
    if (
      !externalCall?.jobId &&
      command.afterRun === 'replaceSelection' &&
      input !== null &&
      fromSelection &&
      deps.replaceSelection
    ) {
      // the selection run reports and logs the outcome itself
      reset()
      await deps.replaceSelection(command)
      return { success: true }
    }
    const call = externalCall
    const running: LauncherStage = { kind: 'running', command }
    stage.value = running
    const runController = new AbortController()
    controller = runController
    if (call?.jobId && deps.claimJob && !(await deps.claimJob(call.jobId))) {
      reset()
      return { success: false, cancelled: true }
    }
    if (input !== null) {
      // the history keeps the text even when the command fails
      await deps.saveOutput?.(input).catch(() => {})
    }
    let outcome: CommandRunOutcome
    try {
      outcome = await deps.run(command, input ?? '', {
        signal: runController.signal,
        source,
        input: call?.input,
        output: call?.output,
      })
    } catch (error) {
      outcome = runController.signal.aborted
        ? { success: false, cancelled: true, message: 'Cancelled' }
        : {
            success: false,
            message: error instanceof Error ? error.message : String(error),
          }
    }
    if (controller === runController) controller = null
    if (call?.jobId) {
      if (externalCall === call) externalCall = null
      outcome = (await deps.finishJob?.(call.jobId, outcome)) ?? outcome
      log(command, input, outcome)
      if (stage.value === running) reset()
      return outcome
    }
    log(command, input, outcome)
    // a new activation started over meanwhile
    if (stage.value !== running) return outcome
    if (outcome.success) {
      reset()
    } else if (input !== null) {
      // the text stays for another try
      text.value = input
      stage.value = { kind: 'prepare', command, autoRun: false }
    } else if (command.confirm === 'always') {
      stage.value = { kind: 'prepare', command, autoRun: false }
    } else {
      stage.value = { kind: 'list' }
    }
    return outcome
  }

  /**
   * Runs the command on `given`, or first asks for its text when there is none,
   * or for a confirmation when the command wants one
   */
  const start = async (
    command: CommandConfig,
    given: string,
    selection: boolean
  ) => {
    const takesText = commandTakesText(command, deps.tools)
    const input = takesText ? given : ''
    const confirm = command.confirm === 'always'
    fromSelection = selection && Boolean(input.trim())
    if ((takesText && !input.trim()) || confirm) {
      text.value = input
      textEdited = false
      stage.value = { kind: 'prepare', command, autoRun: !confirm }
      return
    }
    await execute(command, takesText ? input : null)
  }

  /** Runs a command of the list on the selection */
  const pick = async (command: CommandConfig): Promise<void> => {
    if (stage.value.kind === 'running') return
    source = 'launcher'
    await start(command, deps.selectedText() ?? '', true)
  }

  /**
   * An external call that needs the overlay: its text, otherwise the selection,
   * then the field or a confirmation, as for a picked command
   */
  const request = async (call: LauncherRequest): Promise<void> => {
    reset()
    const command = (deps.commands() ?? []).find(
      (item) => item.id === call.commandId
    )
    if (!command) {
      if (call.jobId)
        await deps.finishJob?.(call.jobId, {
          success: false,
          message: 'Command no longer exists',
        })
      deps.commandMissing?.(call.commandId)
      return
    }
    source = 'external'
    externalCall = call
    await start(
      command,
      call.text ?? (call.jobId ? '' : (deps.selectedText() ?? '')),
      !call.jobId && call.text === undefined
    )
  }

  /** Stops the running command; it is reported as cancelled */
  const cancel = () => {
    if (stage.value.kind === 'running') controller?.abort()
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
    fromSelection = false
  }

  /** The prepared command can run: it has the text it needs */
  const canSubmit = computed(() => {
    const current = stage.value
    if (current.kind !== 'prepare') return false
    return (
      !commandTakesText(current.command, deps.tools) ||
      Boolean(text.value.trim())
    )
  })

  const submit = async (): Promise<void> => {
    const current = stage.value
    if (current.kind !== 'prepare' || !canSubmit.value) return
    await execute(
      current.command,
      commandTakesText(current.command, deps.tools) ? text.value : null
    )
  }

  /** Esc: from a prepared command back to the list; `false` at the list */
  const back = (): boolean => {
    if (stage.value.kind !== 'prepare') return false
    if (externalCall?.jobId) {
      reset()
      return true
    }
    source = 'launcher'
    stage.value = { kind: 'list' }
    return true
  }

  /**
   * The selection is captured after the overlay opens: if it comes while the
   * user is asked for the text and has typed nothing, it becomes the text, and
   * a command that asks for no confirmation runs on it, as if the selection had
   * been there when it was picked
   */
  const selectionArrived = async (selection: string | null | undefined) => {
    const current = stage.value
    if (
      !externalCall?.jobId &&
      current.kind === 'prepare' &&
      commandTakesText(current.command, deps.tools) &&
      !textEdited &&
      !text.value.trim() &&
      selection?.trim()
    ) {
      text.value = selection
      fromSelection = true
      if (current.autoRun) await submit()
    }
  }

  return {
    query,
    highlighted,
    stage,
    text,
    commands,
    visible,
    slotCommands,
    canSubmit,
    reset,
    setQuery,
    move,
    pick,
    pickSlot,
    request,
    cancel,
    cancelExternal: (id: string) => {
      if (externalCall?.jobId === id) reset()
    },
    dismissExternal: () => {
      if (externalCall?.jobId) reset()
    },
    pickHighlighted,
    pickByKey,
    setText,
    submit,
    back,
    selectionArrived,
  }
}

export type CommandLauncherModel = ReturnType<typeof createCommandLauncherModel>
