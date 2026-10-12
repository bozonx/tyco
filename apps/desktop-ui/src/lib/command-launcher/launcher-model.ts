import { computed, ref, shallowRef } from 'vue'

import type {
  CommandConfig,
  CommandRunRecord,
  CommandRunSource,
  LauncherRequest,
} from '@tyco/shared'

import {
  commandAfterRun,
  commandLabel,
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'
import { moveHighlight } from '../menu-query/menu-query'
import type { ToolLookup } from '../tools/tool-types'

/** The first commands of the list are run with the keys `1`–`9` */
export const LAUNCHER_KEY_COUNT = 9

/**
 * What the overlay shows:
 *
 * - `list` — the commands, with the search;
 * - `prepare` — one command before it runs: the text it takes, typed or taken
 *   from the selection. `autoRun`: the command runs as soon as the selection
 *   comes; not after a failed run, whose text stays for another try;
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
    outcome: InvocationOutcome
  ) => Promise<InvocationOutcome | void>
  /** The command library, in the order the user gave it */
  commands: () => readonly CommandConfig[] | undefined
  /** The 15 slots of the command overlay */
  launcherPages?: () => readonly (readonly (string | null)[])[] | undefined
  launcherCommands?: () => readonly (string | null)[] | undefined
  /** The pages whose commands run without the selection */
  launcherPagesWithoutText?: () => readonly number[] | undefined
  /** The text selected in the window the overlay was opened over */
  selectedText: () => string | null | undefined
  /** Runs the command and tells the user how it went */
  run: (
    command: CommandConfig,
    text: string,
    options?: InvocationOptions
  ) => Promise<InvocationOutcome>
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
  const page = ref(0)
  const pageCount = computed(() => 1 + (deps.launcherPages?.()?.length ?? 0))
  const setPage = (index: number) => {
    if (Number.isInteger(index) && index >= 0 && index < pageCount.value)
      page.value = index
  }
  const nextPage = (delta = 1) =>
    setPage((page.value + delta + pageCount.value) % pageCount.value)
  const query = ref('')
  const highlighted = ref(0)
  const stage = shallowRef<LauncherStage>({ kind: 'list' })
  /** The text the prepared command gets */
  const text = ref('')
  /** The user changed the text, so a selection arriving late keeps off it */
  let textEdited = false
  /** The text is the selection of the window under the overlay */
  let fromSelection = false
  /**
   * The user dropped the selection: it is most likely a leftover, since the
   * primary selection outlives a deselection in most apps
   */
  const selectionDropped = ref(false)
  /** The commands take the selection: not dropped, nor on a page without text */
  const selectionAllowed = () =>
    !selectionDropped.value &&
    !deps.launcherPagesWithoutText?.()?.includes(page.value)
  /** The selection the commands take, empty when not allowed */
  const currentSelection = () =>
    selectionAllowed() ? (deps.selectedText() ?? '') : ''
  const selection = computed(currentSelection)
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
    const rawSlots =
      page.value === 0
        ? deps.launcherCommands?.()
        : deps.launcherPages?.()?.[page.value - 1]
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
    page.value = 0
    query.value = ''
    highlighted.value = 0
    text.value = ''
    textEdited = false
    fromSelection = false
    selectionDropped.value = false
    stage.value = { kind: 'list' }
  }

  /** The commands run without the selection until the next activation */
  const dropSelection = () => {
    selectionDropped.value = true
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
    outcome: InvocationOutcome
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
  ): Promise<InvocationOutcome> => {
    if (
      source === 'launcher' &&
      commandAfterRun(command, source, fromSelection) === 'replaceSelection' &&
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
      // another window has the job, or it is over: not ours to finish
      if (externalCall === call) externalCall = null
      reset()
      return { success: false, cancelled: true }
    }
    if (input !== null) {
      // the history keeps the text even when the command fails
      await deps.saveOutput?.(input).catch(() => {})
    }
    let outcome: InvocationOutcome
    try {
      outcome = await deps.run(command, input ?? '', {
        signal: runController.signal,
        source,
        hasSelection: fromSelection,
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
      // a reset meanwhile has finished the job as cancelled already
      if (externalCall === call) {
        externalCall = null
        outcome = (await deps.finishJob?.(call.jobId, outcome)) ?? outcome
      } else {
        outcome = { success: false, cancelled: true, message: 'Cancelled' }
      }
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
    } else {
      stage.value = { kind: 'list' }
    }
    return outcome
  }

  /** Runs the command on `given`, or first asks for its text when there is none */
  const start = async (
    command: CommandConfig,
    given: string,
    selection: boolean
  ) => {
    const takesText = commandTakesText(command, deps.tools)
    const input = takesText ? given : ''
    fromSelection = selection && Boolean(input.trim())
    if (takesText && !input.trim()) {
      text.value = input
      textEdited = false
      stage.value = { kind: 'prepare', command, autoRun: true }
      return
    }
    await execute(command, takesText ? input : null)
  }

  /** Runs a command of the list on the selection */
  const pick = async (command: CommandConfig): Promise<void> => {
    if (stage.value.kind === 'running') return
    source = 'launcher'
    await start(command, currentSelection(), true)
  }

  /**
   * An external call that needs the overlay: use explicit text or ask for
   * input. Selection capture and replacement belong to the caller
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
    await start(command, call.text ?? '', false)
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
    externalCall = null
    source = 'launcher'
    stage.value = { kind: 'list' }
    return true
  }

  /**
   * The selection is captured after the overlay opens: if it comes while the
   * user is asked for the text and has typed nothing, it becomes the text and
   * the command runs on it, as if the selection had been there when it was
   * picked
   */
  const selectionArrived = async (arrived: string | null | undefined) => {
    const current = stage.value
    if (
      source === 'launcher' &&
      selectionAllowed() &&
      current.kind === 'prepare' &&
      commandTakesText(current.command, deps.tools) &&
      !textEdited &&
      !text.value.trim() &&
      arrived?.trim()
    ) {
      text.value = arrived
      fromSelection = true
      if (current.autoRun) await submit()
    }
  }

  return {
    page,
    pageCount,
    setPage,
    nextPage,
    query,
    highlighted,
    stage,
    text,
    selection,
    selectionDropped,
    dropSelection,
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
