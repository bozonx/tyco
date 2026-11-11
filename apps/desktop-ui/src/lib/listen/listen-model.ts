import { computed, ref } from 'vue'

import { joinWords } from '../text/word-spacing'
import type { CaptureSource } from '@tyco/shared'
import type { DictationHandlers } from '../stt/dictation-controller'
import {
  isRetryableDictationError,
  isSettingsFixableDictationError,
} from '../stt/dictation-error'
import {
  createLiveTranscriptState,
  hasNewTranscriptSpeech,
  type LiveTranscriptState,
  liveTranscriptText,
} from '../stt/live-transcript'
import {
  AUTO_STOP_WARNING_MS,
  type AutoStopReason,
  type AutoStopWarning,
  createVoiceSession,
  MAX_RECORDING_MS,
  SILENCE_TIMEOUT_MS,
} from '../stt/voice-session'
import type { TimerDependencies } from '../timers/single-timer'

/**
 * The steps of a listening: recording the sound, waiting for the provider's
 * last words, the transcript to act on, nothing heard, or a failure
 */
export type ListenPhase =
  'idle' | 'recording' | 'finishing' | 'result' | 'empty' | 'failed'

export const SYSTEM_MIX_SOURCE: CaptureSource = { kind: 'systemMix' }

/** The source the listening hotkey starts with, see `stt.listenAppId` */
export function configuredListenSource(
  appId: string | undefined
): CaptureSource {
  const id = appId?.trim()
  return id ? { kind: 'application', appId: id } : SYSTEM_MIX_SOURCE
}

export function isSameSource(a: CaptureSource, b: CaptureSource): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== 'application' || a.appId === (b as typeof a).appId
}

export interface ListenModelDependencies extends TimerDependencies {
  initialText?: string
  now?: () => number
  startDictation: (handlers: DictationHandlers) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  switchSource: (source: CaptureSource) => Promise<void>
  /** Keeps a transcript in the history as a listening */
  saveTranscript: (text: string) => Promise<unknown>
  /** Tells why a recording stopped by itself */
  onAutoStop?: (reason: AutoStopReason) => void
  /** Tells the user what failed */
  describeError: (error: unknown) => string
  /** The overlay is to close: cancelled, or a result dismissed */
  onClose: () => void
}

/** One listening of the computer sound: no commands, no correction. */
export function createListenModel(deps: ListenModelDependencies) {
  let carriedText = deps.initialText ?? ''
  const phase = ref<ListenPhase>('idle')
  const transcript = ref<LiveTranscriptState>(createLiveTranscriptState())
  const source = ref<CaptureSource>(SYSTEM_MIX_SOURCE)
  /** The source's application plays nothing yet */
  const isWaiting = ref(false)
  /**
   * The chosen application quit: capture waits for it without recording other
   * apps
   */
  const isSourceLost = ref(false)
  const isSwitching = ref(false)
  const isStarting = ref(false)
  const autoStopWarning = ref<AutoStopWarning | undefined>()
  const resultText = ref('')
  const errorText = ref('')
  const errorCause = ref<unknown>(undefined)
  let generation = 0
  let lastState = createLiveTranscriptState()
  let lastStartSource: CaptureSource = SYSTEM_MIX_SOURCE

  const canOpenSettings = computed(() =>
    isSettingsFixableDictationError(errorCause.value)
  )
  const canRetry = computed(
    () => !canOpenSettings.value || isRetryableDictationError(errorCause.value)
  )

  const session = createVoiceSession({
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    now: deps.now,
    maxRecordingMs: MAX_RECORDING_MS,
    silenceTimeoutMs: SILENCE_TIMEOUT_MS,
    warningLeadMs: AUTO_STOP_WARNING_MS,
    onWarning: (warning) => {
      autoStopWarning.value = warning
    },
    onAutoStop: (reason) => {
      deps.onAutoStop?.(reason)
      void stop()
    },
  })

  const isRecording = computed(() => phase.value === 'recording')

  const fail = (error: unknown) => {
    session.stopTimer()
    errorCause.value = error
    errorText.value = deps.describeError(error)
    const text = liveTranscriptText(transcript.value).trim()
    if (text) {
      resultText.value = text
      phase.value = 'result'
      void deps.saveTranscript(text).catch(() => undefined)
    } else phase.value = 'failed'
  }

  async function start(startSource: CaptureSource = lastStartSource) {
    const run = ++generation
    isStarting.value = true
    isSwitching.value = false
    lastStartSource = startSource
    source.value = startSource
    transcript.value = { committed: carriedText, draft: '' }
    lastState = transcript.value
    isWaiting.value = startSource.kind === 'application'
    isSourceLost.value = false
    resultText.value = ''
    errorCause.value = undefined
    errorText.value = ''
    phase.value = 'recording'
    session.begin()
    try {
      await deps.startDictation({
        source: startSource,
        isContinuous: true,
        onText: (state) => {
          if (run !== generation) return
          // music and silence are no speech: only new words hold the session
          if (hasNewTranscriptSpeech(lastState, state)) session.markActivity()
          lastState = state
          transcript.value = {
            ...state,
            committed: joinWords(carriedText, state.committed),
          }
        },
        onError: (error) => {
          if (run !== generation || phase.value !== 'recording') return
          // what was heard before the failure is not lost
          if (liveTranscriptText(transcript.value)) {
            errorCause.value = error
            errorText.value = deps.describeError(error)
            void stop()
          } else fail(error)
        },
        onWaiting: (waiting) => {
          if (run !== generation) return
          isWaiting.value = waiting
          if (!waiting) isSourceLost.value = false
        },
        onSourceLost: (next) => {
          if (run !== generation) return
          source.value = next
          isWaiting.value = true
          isSourceLost.value = true
        },
      })
    } catch (error) {
      if (run === generation && phase.value === 'recording') fail(error)
    } finally {
      if (run === generation) isStarting.value = false
    }
  }

  async function stop() {
    if (phase.value !== 'recording') return
    const run = generation
    phase.value = 'finishing'
    session.stopTimer()
    let text: string
    try {
      text = joinWords(carriedText, (await deps.finishDictation()).trim())
    } catch (error) {
      text = liveTranscriptText(transcript.value).trim()
      if (!text) {
        if (run === generation) fail(error)
        return
      }
    }
    if (run !== generation) return
    if (!text) {
      phase.value = 'empty'
      return
    }
    carriedText = ''
    resultText.value = text
    phase.value = 'result'
    void deps.saveTranscript(text).catch(() => undefined)
  }

  async function cancel() {
    generation += 1
    session.stopTimer()
    phase.value = 'idle'
    await deps.cancelDictation().catch(() => undefined)
  }

  /** Records `next` from now on; the transcript so far stays */
  async function selectSource(next: CaptureSource) {
    if (
      isStarting.value ||
      isSwitching.value ||
      isSameSource(next, source.value)
    )
      return
    if (phase.value !== 'recording') return
    const run = generation
    const previousWaiting = isWaiting.value
    isSwitching.value = true
    errorText.value = ''
    isWaiting.value = next.kind === 'application'
    try {
      await deps.switchSource(next)
      if (run !== generation || phase.value !== 'recording') return
      source.value = next
      lastStartSource = next
      isSourceLost.value = false
    } catch (error) {
      if (run !== generation || phase.value !== 'recording') return
      isWaiting.value = previousWaiting
      errorText.value = deps.describeError(error)
    } finally {
      if (run === generation) isSwitching.value = false
    }
  }

  /** The listening hotkey again: stops a recording, closes what follows */
  async function repeatHotkey() {
    if (phase.value === 'recording') return stop()
    if (phase.value === 'finishing') return
    await cancel()
    deps.onClose()
  }

  async function close() {
    await cancel()
    deps.onClose()
  }

  return {
    phase,
    transcript,
    source,
    isWaiting,
    isSourceLost,
    isSwitching,
    isStarting,
    isRecording,
    autoStopWarning,
    resultText,
    errorText,
    canOpenSettings,
    canRetry,
    start,
    stop,
    cancel,
    close,
    retry: () => start(lastStartSource),
    restartWithCurrentSource: () => start(source.value),
    selectSource,
    repeatHotkey,
    dispose: () => {
      generation += 1
      session.dispose()
      void deps.cancelDictation().catch(() => undefined)
    },
  }
}

export type ListenModel = ReturnType<typeof createListenModel>
