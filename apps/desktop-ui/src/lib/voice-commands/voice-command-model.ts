import { isBuiltInVoiceCommand } from './built-in-voice-commands'
import { commandUnavailableReason } from '../commands/command-runtime'
import { computed, ref, shallowRef } from 'vue'
import type { CommandConfig } from '@tyco/shared'
import type { InvocationOutcome } from '../invocation/invocation-types'
import type { DictationHandlers } from '../stt/dictation-controller'
import { type DictationError, dictationErrorKey } from '../stt/dictation-error'
import {
  createLiveTranscriptState,
  liveTranscriptText,
  type LiveTranscriptState,
} from '../stt/live-transcript'
import type { ToolLookup } from '../tools/tool-types'
import type { TimerDependencies } from '../timers/single-timer'
import {
  AUTO_STOP_WARNING_MS,
  type AutoStopReason,
  type AutoStopWarning,
  createVoiceSession,
  MAX_RECORDING_MS,
  SILENCE_TIMEOUT_MS,
} from '../stt/voice-session'
import {
  compileVoiceRoutes,
  isVoiceCommand,
  resolveVoice,
  voiceInputIssue,
  type VoiceCandidate,
} from './voice-resolver'

export interface VoiceCommandContext {
  selectionText: string
}

export interface VoiceCommandDependencies extends TimerDependencies {
  commands: () => readonly CommandConfig[]
  builtInCommands?: () => readonly CommandConfig[]
  tools: ToolLookup
  context?: VoiceCommandContext | (() => VoiceCommandContext | undefined)
  startDictation: (handlers: DictationHandlers) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  run: (
    command: CommandConfig,
    text: string,
    signal: AbortSignal,
    context?: VoiceCommandContext
  ) => Promise<InvocationOutcome>
  /** The recognized speech, kept in the history before anything runs */
  saveTranscript?: (text: string) => Promise<unknown>
  /** A dictation failure with its details, in the user's language */
  describeError?: (cause: unknown) => string
  /** Silence is billed too: a forgotten recording must not run all day */
  maxRecordingMs?: number
  silenceTimeoutMs?: number
  now?: () => number
}

/** Why a recording stopped by itself, as message keys */
const AUTO_STOP_ERRORS: Record<AutoStopReason, string> = {
  limit: 'toast.recordingLimitReached',
  silence: 'toast.recordingSilenceStop',
}

/**
 * The text of `error`: a message key for failures the app describes itself,
 * which the view translates, or the error's own message
 */
function errorText(
  cause: unknown,
  describe?: (cause: unknown) => string
): string {
  const key = dictationErrorKey(cause)
  // a failure with details is told with them: the view cannot add them to
  // a bare key
  if (key && !(cause as DictationError).details) return key
  if (key && describe) return describe(cause)
  return cause instanceof Error ? cause.message : String(cause)
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
  /** A message key (`voiceCommands.*`, `toast.*`) or a message as it came */
  const error = ref('')
  const autoStopWarning = shallowRef<AutoStopWarning>()
  const explicitContext = shallowRef<VoiceCommandContext | undefined>()
  const context = computed(() => {
    if (explicitContext.value !== undefined) return explicitContext.value
    if (typeof deps.context === 'function') return deps.context()
    return deps.context
  })
  let generation = 0
  /** Why the session broke while `finish` was waiting for its last words */
  let interruption: string | undefined
  let disposed = false
  let starting: Promise<void> | undefined
  let stopping = Promise.resolve()
  let controller: AbortController | undefined
  const voiceSession = createVoiceSession({
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    now: deps.now,
    maxRecordingMs: deps.maxRecordingMs ?? MAX_RECORDING_MS,
    silenceTimeoutMs: deps.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS,
    warningLeadMs: AUTO_STOP_WARNING_MS,
    onWarning: (warning) => {
      autoStopWarning.value = warning
    },
    onAutoStop: (reason) => {
      if (stage.value !== 'recording') return
      // the text is kept for review: it is not run on its own
      interruption = AUTO_STOP_ERRORS[reason]
      void finish('review')
    },
  })
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
      ? voiceInputIssue(
          command.value,
          inputText.value,
          deps.tools,
          context.value
        )
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
      deps.tools,
      context.value
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
      voiceInputIssue(target, inputText.value, deps.tools, context.value)
    )
      return
    const current = generation
    const text = inputText.value
    controller = new AbortController()
    error.value = ''
    stage.value = 'running'
    try {
      const result = await (context.value
        ? deps.run(target, text, controller.signal, context.value)
        : deps.run(target, text, controller.signal))
      if (current !== generation || disposed) return
      if (!result.success)
        error.value = result.message || 'voiceCommands.failed'
      // Keep the transcript and input, including after a successful run.
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = errorText(cause, deps.describeError)
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

  /** The same command with the same parameters */
  const isSameCall = (a: VoiceCandidate, b: VoiceCandidate | undefined) =>
    Boolean(b) &&
    a.commandId === b!.commandId &&
    JSON.stringify(a.parameters) === JSON.stringify(b!.parameters)

  /**
   * Settles a recording on its text and picks the command it names. A session
   * that broke is never run on its own: its text may be cut short. Only the
   * command the user saw recognized when asking to run runs on its own: the
   * final transcript may name another one.
   */
  const review = async (
    text: string,
    intent: VoiceCommandFinishIntent,
    brokenBy?: string,
    expected?: VoiceCandidate
  ) => {
    transcript.value = text
    liveTranscript.value = { committed: text, draft: '' }
    inputText.value = text
    stage.value = 'review'
    const result = resolveVoice(routes.value, text)
    if (result.kind === 'match') {
      const candidate = result.candidates[0]!
      choose(candidate)
      // dropped speech is shown for review before anything runs
      if (
        !brokenBy &&
        intent === 'run' &&
        isSameCall(candidate, expected) &&
        !candidate.commandOffset &&
        canRun.value
      )
        await run()
    } else if (result.parameterChoices?.[0]) {
      choose(result.parameterChoices[0])
    }
    // after `choose`, which clears the error
    if (brokenBy) error.value = brokenBy
  }

  const finish = async (intent: VoiceCommandFinishIntent = 'run') => {
    if (stage.value !== 'recording') return
    // what the user asked to run, as shown when they asked
    const expected = canRunLive.value ? activeCandidate.value : undefined
    voiceSession.stopTimer()
    stage.value = 'finishing'
    const current = generation
    try {
      await starting
      if (current !== generation || disposed || stage.value !== 'finishing')
        return
      const finalText = await deps.finishDictation()
      if (current !== generation || disposed) return
      if (!finalText.trim()) {
        error.value = interruption ?? 'voiceCommands.nothingHeard'
        stage.value = 'review'
        return
      }
      // the only copy of what was said: it cannot be dictated the same way
      // twice, and the review may end without running anything
      void deps.saveTranscript?.(finalText).catch(() => undefined)
      await review(finalText, intent, interruption, expected)
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = errorText(cause, deps.describeError)
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
    interruption = undefined
    // Preserve the previous text until new recognition explicitly replaces it.
    selected.value = undefined
    liveTranscript.value = createLiveTranscriptState()
    voiceSession.begin()
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
            const text = liveTranscriptText(state)
            // empty results come in silence too: only new words are speech
            if (text !== transcript.value) voiceSession.markActivity()
            transcript.value = text
          }
        },
        onError: (cause) => {
          if (current !== generation || disposed) return
          // `finish` still gets what was heard before the failure
          if (stage.value === 'finishing') {
            interruption = errorText(cause, deps.describeError)
            return
          }
          generation += 1
          voiceSession.abort()
          stopping = stopping
            .then(() => deps.cancelDictation())
            .catch(() => undefined)
          const heard = liveTranscriptText(liveTranscript.value)
          if (heard.trim()) {
            void deps.saveTranscript?.(heard).catch(() => undefined)
            void review(heard, 'review', errorText(cause, deps.describeError))
            return
          }
          error.value = errorText(cause, deps.describeError)
          stage.value = 'review'
        },
      })
    })()
      .catch((cause: unknown) => {
        if (current !== generation || disposed) return
        voiceSession.abort()
        error.value = errorText(cause, deps.describeError)
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
    voiceSession.abort()
    controller?.abort()
    stage.value = 'idle'
    error.value = ''
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
    autoStopWarning,
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
    context,
    setContext: (ctx?: VoiceCommandContext) => {
      explicitContext.value = ctx
    },
    run,
    start,
    finish,
    cancel,
    dispose() {
      disposed = true
      void cancel().catch(() => undefined)
      voiceSession.dispose()
    },
  }
}
