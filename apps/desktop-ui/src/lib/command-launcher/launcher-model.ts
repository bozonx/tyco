import { computed, ref, shallowRef } from 'vue'

import type {
  CommandConfig,
  LauncherPageConfig,
  LauncherRequest,
} from '@tyco/shared'

import {
  commandLabel,
  commandTakesText,
  isCommandAvailable,
} from '../commands/command-runtime'
import { moveHighlight } from '../menu-query/menu-query'
import { SHORTCUT_SLOT_COUNT, slotList } from '../shortcut-slots/shortcut-slots'
import type { ToolLookup } from '../tools/tool-types'
import {
  createLauncherExecution,
  type LauncherExecutionDependencies,
  type LauncherStage,
} from './launcher-execution'

export type { LauncherStage } from './launcher-execution'

/** The first commands of the list are run with the keys `1`–`9` */
const LAUNCHER_KEY_COUNT = 9

/** Whether the overlay offers the command */
export function isLauncherCommand(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return command.isEnabled && isCommandAvailable(command, tools)
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

export interface CommandLauncherDependencies extends LauncherExecutionDependencies {
  /** The tools the commands run */
  tools: ToolLookup
  /** The command library, in the order the user gave it */
  commands: () => readonly CommandConfig[] | undefined
  /** The 15 slots of the command overlay */
  launcherPages: () => readonly LauncherPageConfig[]
  /** The text selected in the window the overlay was opened over */
  selectedText: () => string | null | undefined
  /** Tells that a command of an external call is gone from the library */
  commandMissing?: (commandId: string) => void
}

/** The command overlay opened from the keyboard: list, search, keys, input */
export function createCommandLauncherModel(deps: CommandLauncherDependencies) {
  let disposed = false
  const pageIndex = ref(0)
  const pageCount = computed(() => deps.launcherPages().length)
  const setPage = (index: number) => {
    if (Number.isInteger(index) && index >= 0 && index < pageCount.value)
      pageIndex.value = index
  }
  const nextPage = (delta = 1) =>
    setPage((pageIndex.value + delta + pageCount.value) % pageCount.value)
  const query = ref('')
  const highlightedCommandIndex = ref(0)
  const stage = shallowRef<LauncherStage>({ kind: 'list' })
  /** The text the prepared command gets */
  const inputText = ref('')
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
    deps.launcherPages()[pageIndex.value]?.inputMode !== 'none'
  /** The selection the commands take, empty when not allowed */
  const currentSelection = () =>
    selectionAllowed() ? (deps.selectedText() ?? '') : ''
  const selection = computed(currentSelection)
  const commands = computed(() =>
    (deps.commands() ?? []).filter((command) =>
      isLauncherCommand(command, deps.tools)
    )
  )
  const filteredCommands = computed(() =>
    searchCommands(commands.value, query.value)
  )

  const slotCommands = computed<(CommandConfig | null)[]>(() => {
    const slots = deps.launcherPages()[pageIndex.value]?.slots ?? {}
    const all = deps.commands() ?? []
    if (Object.keys(slots).length > 0) {
      return slotList(slots).map(
        (id) => (id && all.find((cmd) => cmd.id === id)) || null
      )
    }
    return Array.from(
      { length: SHORTCUT_SLOT_COUNT },
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
    execution.reset()
    pageIndex.value = 0
    query.value = ''
    highlightedCommandIndex.value = 0
    inputText.value = ''
    textEdited = false
    fromSelection = false
    selectionDropped.value = false
    stage.value = { kind: 'list' }
  }

  const execution = createLauncherExecution(deps, {
    stage,
    inputText,
    fromSelection: () => fromSelection,
    reset,
  })
  const execute = execution.execute

  /** The commands run without the selection until the next activation */
  const dropSelection = () => {
    selectionDropped.value = true
  }

  const setQuery = (value: string) => {
    query.value = value
    highlightedCommandIndex.value = 0
  }

  const move = (delta: number) => {
    highlightedCommandIndex.value = moveHighlight(
      highlightedCommandIndex.value,
      delta,
      filteredCommands.value.length
    )
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
      inputText.value = input
      textEdited = false
      stage.value = { kind: 'prepare', command, autoRun: true }
      return
    }
    await execute(command, takesText ? input : null)
  }

  /** Runs a command of the list on the selection */
  const pick = async (command: CommandConfig): Promise<void> => {
    if (disposed || stage.value.kind === 'running') return
    execution.useLauncher()
    await start(command, currentSelection(), true)
  }

  /**
   * An external call that needs the overlay: use explicit text or ask for
   * input. Selection capture and replacement belong to the caller
   */
  const request = async (call: LauncherRequest): Promise<void> => {
    if (disposed) return
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
      if (!disposed) deps.commandMissing?.(call.commandId)
      return
    }
    execution.prepare(call)
    await start(command, call.text ?? '', false)
  }

  /** Stops the running command; it is reported as cancelled */
  const cancel = () => {
    if (stage.value.kind === 'running') execution.cancel()
  }

  const pickHighlighted = () => {
    const command = filteredCommands.value[highlightedCommandIndex.value]
    return command ? pick(command) : Promise.resolve()
  }

  /** `1`–`9`: the command at that place of the list */
  const pickByKey = (key: number) => {
    const command =
      key >= 1 && key <= LAUNCHER_KEY_COUNT
        ? filteredCommands.value[key - 1]
        : undefined
    return command ? pick(command) : Promise.resolve()
  }

  const setText = (value: string) => {
    inputText.value = value
    textEdited = true
    fromSelection = false
  }

  /** The prepared command can run: it has the text it needs */
  const canSubmit = computed(() => {
    const current = stage.value
    if (current.kind !== 'prepare') return false
    return (
      !commandTakesText(current.command, deps.tools) ||
      Boolean(inputText.value.trim())
    )
  })

  const submit = async (): Promise<void> => {
    const current = stage.value
    if (disposed || current.kind !== 'prepare' || !canSubmit.value) return
    await execute(
      current.command,
      commandTakesText(current.command, deps.tools) ? inputText.value : null
    )
  }

  /** Esc: from a prepared command back to the list; `false` at the list */
  const back = (): boolean => {
    if (stage.value.kind !== 'prepare') return false
    if (execution.externalCall?.jobId) {
      reset()
      return true
    }
    execution.prepare(null)
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
      execution.source === 'launcher' &&
      selectionAllowed() &&
      current.kind === 'prepare' &&
      commandTakesText(current.command, deps.tools) &&
      !textEdited &&
      !inputText.value.trim() &&
      arrived?.trim()
    ) {
      inputText.value = arrived
      fromSelection = true
      if (current.autoRun) await submit()
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    execution.dispose()
    reset()
  }
  return {
    dispose,
    pageIndex,
    pageCount,
    setPage,
    nextPage,
    query,
    highlightedCommandIndex,
    stage,
    inputText,
    selection,
    selectionDropped,
    dropSelection,
    commands,
    filteredCommands,
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
      if (execution.externalCall?.jobId === id) reset()
    },
    dismissExternal: () => {
      if (execution.externalCall?.jobId) reset()
    },
    pickHighlighted,
    pickByKey,
    setText,
    submit,
    back,
    selectionArrived,
  }
}
