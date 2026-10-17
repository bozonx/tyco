import { isBuiltInVoiceCommand } from './built-in-voice-commands'
import { commandUnavailableReason } from '../commands/command-runtime'
import { computed, ref, shallowRef } from 'vue'
import type { CommandConfig } from '@tyco/shared'
import type { InvocationOutcome } from '../invocation/invocation-types'
import type { DictationHandlers } from '../stt/dictation-controller'
import {
  createLiveTranscriptState,
  liveTranscriptText,
  type LiveTranscriptState,
} from '../stt/live-transcript'
import type { ToolLookup } from '../tools/tool-types'
import {
  compileVoiceRoutes,
  isVoiceCommand,
  resolveVoice,
  voiceInputIssue,
  type VoiceCandidate,
} from './voice-resolver'

export interface VoiceCommandDependencies {
  commands: () => readonly CommandConfig[]
  builtInCommands?: () => readonly CommandConfig[]
  tools: ToolLookup
  startDictation: (handlers: DictationHandlers) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  run: (
    command: CommandConfig,
    text: string,
    signal: AbortSignal
  ) => Promise<InvocationOutcome>
}

/** Whether a finished recording runs its command at once or waits for review */
export type VoiceCommandFinishIntent = 'run' | 'review'

/** One activation owns recognition and execution; partial text can never run. */
export function createVoiceCommandModel(deps: VoiceCommandDependencies) {
  const stage = ref<'idle' | 'recording' | 'finishing' | 'review' | 'running'>(
    'idle'
  )
  const transcript = ref('')
  /** What the recognizer has heard so far, split for the live display */
  const liveTranscript = shallowRef<LiveTranscriptState>(
    createLiveTranscriptState()
  )
  const inputText = ref('')
  const selected = shallowRef<VoiceCandidate>()
  const error = ref('')
  let generation = 0
  let disposed = false
  let starting: Promise<void> | undefined
  let stopping = Promise.resolve()
  let controller: AbortController | undefined
  const commands = computed(() => [
    ...(deps.builtInCommands?.() ?? []),
    ...deps.commands().filter((item) => !isBuiltInVoiceCommand(item)),
  ])
  const findCommand = (id: string | undefined) =>
    commands.value.find((item) => item.id === id)
  const routes = computed(() => compileVoiceRoutes(commands.value, deps.tools))
  const activeTranscriptText = computed(() => {
    if (stage.value === 'recording' || stage.value === 'finishing') {
      return liveTranscriptText(liveTranscript.value)
    }
    return transcript.value
  })
  const resolution = computed(() =>
    resolveVoice(routes.value, activeTranscriptText.value)
  )
  const activeCandidate = computed<VoiceCandidate | undefined>(() => {
    if (stage.value === 'review' || stage.value === 'running') {
      return selected.value
    }
    return (
      resolution.value.candidates[0] ?? resolution.value.parameterChoices?.[0]
    )
  })
  const hasMatchedCommand = computed(() => Boolean(activeCandidate.value))
  const recordingPhase = computed<'awaiting-command' | 'capturing-args'>(() => {
    if (stage.value !== 'recording' && stage.value !== 'finishing') {
      return 'awaiting-command'
    }
    return hasMatchedCommand.value ? 'capturing-args' : 'awaiting-command'
  })
  const catalogRoutes = computed(() =>
    compileVoiceRoutes(commands.value, deps.tools, true)
  )
  const catalog = computed(() =>
    commands.value.filter((command) =>
      catalogRoutes.value.some((route) => route.commandId === command.id)
    )
  )
  const command = computed(() => findCommand(selected.value?.commandId))
  const activeCommand = computed(
    () => findCommand(activeCandidate.value?.commandId) ?? command.value
  )
  const inputIssue = computed(() =>
    command.value
      ? voiceInputIssue(command.value, inputText.value, deps.tools)
      : undefined
  )
  /** Speech before the recognized command, dropped as a failed attempt */
  const discardedText = computed(() =>
    transcript.value.slice(0, selected.value?.commandOffset ?? 0).trim()
  )
  const canRun = computed(
    () =>
      stage.value === 'review' &&
      command.value &&
      isVoiceCommand(command.value, deps.tools) &&
      !inputIssue.value
  )
  const canRunLive = computed(() => {
    if (stage.value !== 'recording' && stage.value !== 'finishing') {
      return false
    }
    if (!activeCommand.value || !activeCandidate.value) {
      return false
    }
    if (!isVoiceCommand(activeCommand.value, deps.tools)) {
      return false
    }
    const issue = voiceInputIssue(
      activeCommand.value,
      activeCandidate.value.text,
      deps.tools
    )
    return !issue
  })

  const choose = (candidate: VoiceCandidate) => {
    if (stage.value !== 'review') return
    selected.value = candidate
    inputText.value = candidate.text
    error.value = ''
  }
  // the field holds the text the user sees, possibly edited: it is kept
  const chooseCommand = (commandId: string) =>
    choose({
      commandId,
      text: inputText.value,
      parameters: {},
      consumedWordCount: 0,
      textOffset: 0,
      commandOffset: 0,
    })

  const run = async () => {
    const target = findCommand(selected.value?.commandId)
    if (
      stage.value !== 'review' ||
      !target ||
      !isVoiceCommand(target, deps.tools) ||
      voiceInputIssue(target, inputText.value, deps.tools)
    )
      return
    const current = generation
    const text = inputText.value
    controller = new AbortController()
    error.value = ''
    stage.value = 'running'
    try {
      const result = await deps.run(target, text, controller.signal)
      if (current !== generation || disposed) return
      if (!result.success)
        error.value = result.message || 'voiceCommands.failed'
      // Keep the transcript and input, including after a successful run.
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === generation && !disposed) {
        controller = undefined
        stage.value = 'review'
      }
    }
  }

  /** Swaps the chosen command for a sibling, such as another language */
  const switchCommand = (commandId: string) => {
    if (stage.value !== 'review' || !selected.value) return
    selected.value = { ...selected.value, commandId }
    error.value = ''
  }

  const finish = async (intent: VoiceCommandFinishIntent = 'run') => {
    if (stage.value !== 'recording') return
    stage.value = 'finishing'
    const current = generation
    try {
      await starting
      if (current !== generation || disposed || stage.value !== 'finishing')
        return
      const finalText = await deps.finishDictation()
      if (current !== generation || disposed) return
      if (!finalText.trim()) {
        error.value = 'voiceCommands.nothingHeard'
        stage.value = 'review'
        return
      }
      transcript.value = finalText
      liveTranscript.value = { committed: finalText, draft: '' }
      inputText.value = finalText
      stage.value = 'review'
      const result = resolveVoice(
        compileVoiceRoutes(commands.value, deps.tools),
        finalText
      )
      if (result.kind === 'match') {
        const candidate = result.candidates[0]!
        choose(candidate)
        // dropped speech is shown for review before anything runs
        if (intent === 'run' && !candidate.commandOffset && canRun.value)
          await run()
      } else if (result.parameterChoices?.[0]) {
        choose(result.parameterChoices[0])
      }
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      stage.value = 'review'
    }
  }

  const start = async () => {
    if (
      disposed ||
      stage.value === 'recording' ||
      stage.value === 'finishing' ||
      stage.value === 'running'
    )
      return
    const current = ++generation
    stage.value = 'recording'
    error.value = ''
    // Preserve the previous text until new recognition explicitly replaces it.
    selected.value = undefined
    liveTranscript.value = createLiveTranscriptState()
    const pending = (async () => {
      await stopping
      if (current !== generation || disposed) return
      await deps.startDictation({
        onText: (state) => {
          if (
            current === generation &&
            !disposed &&
            stage.value === 'recording'
          ) {
            liveTranscript.value = state
            transcript.value = liveTranscriptText(state)
          }
        },
        onError: (cause) => {
          if (current !== generation || disposed) return
          generation += 1
          error.value = cause.message
          stage.value = 'review'
          stopping = stopping
            .then(() => deps.cancelDictation())
            .catch(() => undefined)
        },
      })
    })()
      .catch((cause: unknown) => {
        if (current !== generation || disposed) return
        error.value = cause instanceof Error ? cause.message : String(cause)
        stage.value = 'review'
      })
      .finally(() => {
        if (starting === pending) starting = undefined
      })
    starting = pending
    await pending
  }

  const cancel = () => {
    generation += 1
    controller?.abort()
    stage.value = 'idle'
    transcript.value = ''
    inputText.value = ''
    selected.value = undefined
    liveTranscript.value = createLiveTranscriptState()
    const pending = starting
    stopping = stopping
      .then(async () => {
        await deps.cancelDictation()
        await pending
        await deps.cancelDictation()
      })
      .catch(() => undefined)
    return stopping
  }
  return {
    stage,
    recordingPhase,
    hasMatchedCommand,
    activeCandidate,
    activeCommand,
    transcript,
    liveTranscript,
    inputText,
    selected,
    error,
    routes,
    catalogRoutes,
    unavailableReason: (command: CommandConfig) =>
      commandUnavailableReason(command, deps.tools),
    resolution,
    catalog,
    builtInCatalog: computed(() => catalog.value.filter(isBuiltInVoiceCommand)),
    customCatalog: computed(() =>
      catalog.value.filter((item) => !isBuiltInVoiceCommand(item))
    ),
    command,
    inputIssue,
    discardedText,
    canRun,
    canRunLive,
    choose,
    chooseCommand,
    switchCommand,
    run,
    start,
    finish,
    cancel,
    dispose() {
      disposed = true
      void cancel().catch(() => undefined)
    },
  }
}
