import { computed, ref } from 'vue'
import { DictationError, type LiveDictationStart } from './live-dictation'
import {
  createLiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'
import type { VoiceFinishIntent } from './voice-finish-intent'
import { createVoiceSession } from './voice-session'

export interface VoiceRecognitionDependencies {
  startDictation: (
    handlers: Pick<LiveDictationStart, 'onText' | 'onError'>
  ) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  shouldFormatRecognizedText: () => boolean
  voiceCorrection: (text: string, signal?: AbortSignal) => Promise<string>
  saveSource: (
    text: string,
    action: 'voiceCorrection'
  ) => Promise<string | null>
  saveSourceResult: (sourceId: string | null, text: string) => Promise<unknown>
  setPendingModal: (options: {
    correction: boolean
    onCancel: () => void
  }) => number
  clearPendingModal: (owner: number) => void
  options: () => { chat?: boolean; prefix?: string }
  onCorrected: (
    result: string,
    recognized: string,
    corrected: string | undefined,
    intent: VoiceFinishIntent
  ) => void
  onCancelled: () => void
  t: (key: string) => string
  toastKey: (key: string, kind: 'warn' | 'error') => void
  toastText: (text: string, kind: 'error') => void
}

export function createVoiceRecognition(deps: VoiceRecognitionDependencies) {
  const {
    startDictation,
    finishDictation,
    cancelDictation,
    shouldFormatRecognizedText,
    voiceCorrection,
    t,
    toastKey,
    toastText,
  } = deps
  const transcript = ref(createLiveTranscriptState())
  const hasText = computed(() => Boolean(liveTranscriptText(transcript.value)))
  const isFinishing = ref(false)
  const isCancelling = ref(false)
  const isStarted = ref(false)
  const isTranscribing = ref(false)
  const audioLevel = ref(0)
  const audioPeak = ref(0)
  const recordingDurationMs = ref(0)
  let recordingTimer: ReturnType<typeof setInterval> | undefined
  let sessionGeneration = 0
  let starting: Promise<void> | undefined
  let cancelling: Promise<void> | undefined
  let notifyCancellation = false
  let restartGeneration = 0
  let disposed = false
  /** Set once a dictation started; it stays finishable after a failure */
  let hasSession = false
  // Silence is billed too: a forgotten dictation must not run all day
  const MAX_RECORDING_MS = 3_600_000

  function startRecordingTimer() {
    recordingDurationMs.value = 0
    const startTime = Date.now()
    if (recordingTimer !== undefined) {
      clearInterval(recordingTimer)
    }
    recordingTimer = setInterval(() => {
      recordingDurationMs.value = Date.now() - startTime
    }, 100)
  }

  function stopRecordingTimer() {
    if (recordingTimer !== undefined) {
      clearInterval(recordingTimer)
      recordingTimer = undefined
    }
    audioLevel.value = 0
    audioPeak.value = 0
  }

  const voiceSession = createVoiceSession({
    maxRecordingMs: MAX_RECORDING_MS,
    onLimit: () => {
      toastKey('toast.recordingLimitReached', 'warn')
      void finish()
    },
  })

  const DICTATION_ERROR_KEYS = {
    closed: 'toast.dictationClosed',
    timeout: 'toast.dictationTimeout',
  } as const

  /** What went wrong, in the words of the user's language where they are ours */
  function describeVoiceError(error: unknown): string {
    if (error instanceof DictationError)
      return t(DICTATION_ERROR_KEYS[error.kind])
    return error instanceof Error ? error.message : String(error)
  }

  function notifyCancelled() {
    deps.onCancelled()
  }

  const cancelSession = (notify: boolean): Promise<void> => {
    notifyCancellation ||= notify
    if (cancelling) return cancelling
    isCancelling.value = true
    sessionGeneration += 1
    hasSession = false
    stopRecordingTimer()
    voiceSession.abort()

    cancelling = (async () => {
      try {
        await cancelDictation()
        await starting
        await cancelDictation()
      } catch (error) {
        const message = describeVoiceError(error)
        if (message) toastText(message, 'error')
        else toastKey('toast.voiceRecognitionFailed', 'error')
      } finally {
        isStarted.value = false
        isTranscribing.value = false
        isFinishing.value = false
        isCancelling.value = false
        cancelling = undefined
        const shouldNotify = notifyCancellation
        notifyCancellation = false
        if (shouldNotify && !disposed) notifyCancelled()
      }
    })()
    return cancelling
  }

  const cancel = () => {
    restartGeneration += 1
    return cancelSession(true)
  }

  const finish = async (intent: VoiceFinishIntent = 'insert') => {
    if (isFinishing.value || isCancelling.value) {
      return
    }

    const generation = sessionGeneration
    let signal = voiceSession.signal
    const isCurrent = () => generation === sessionGeneration && !signal?.aborted
    isFinishing.value = true
    stopRecordingTimer()
    voiceSession.stopTimer()

    try {
      await starting
      signal = voiceSession.signal
      if (!isCurrent()) return
      if (!hasSession || signal?.aborted) {
        notifyCancelled()
        return
      }
      hasSession = false
      isTranscribing.value = true
      // the provider's last words arrive after the microphone is off
      const recognizedText = await finishDictation()
      if (!isCurrent()) return
      isStarted.value = false
      isTranscribing.value = false

      if (!recognizedText.trim()) {
        if (
          deps.options().chat &&
          intent === 'submit' &&
          deps.options().prefix?.trim()
        ) {
          deps.onCorrected('', '', undefined, 'submit')
          return
        }
        toastKey('toast.nothingRecognized', 'warn')
        notifyCancelled()
        return
      }

      let resultText = recognizedText
      let correctedText: string | undefined

      if (shouldFormatRecognizedText()) {
        // the raw transcript is the only copy of what was said: the LLM may
        // distort it, and it cannot be dictated the same way twice
        let sourceId: string | null = null
        try {
          sourceId = await deps.saveSource(recognizedText, 'voiceCorrection')
        } catch {
          // the text is still here; only its copy in the history is missing
          toastKey('history.operationFailed', 'error')
        }
        if (!isCurrent()) return
        const owner = deps.setPendingModal({
          correction: true,
          onCancel: () => voiceSession.abort(),
        })

        try {
          const formattedText = await voiceCorrection(recognizedText, signal)

          if (!isCurrent()) return
          if (formattedText.trim()) {
            resultText = formattedText
            correctedText = formattedText
            await deps.saveSourceResult(sourceId, formattedText).catch(() => {
              toastKey('history.operationFailed', 'error')
            })
          }
        } catch {
          // the request has told the failure; the raw text goes on
          if (!isCurrent()) return
        } finally {
          deps.clearPendingModal(owner)
        }
      }

      if (!isCurrent()) return
      deps.onCorrected(resultText, recognizedText, correctedText, intent)
    } catch (error) {
      if (!isCurrent()) return
      if (!signal?.aborted) {
        const message = describeVoiceError(error)
        if (message) toastText(message, 'error')
        else toastKey('toast.voiceRecognitionFailed', 'error')
      }
      notifyCancelled()
    } finally {
      if (generation === sessionGeneration) {
        isStarted.value = false
        isTranscribing.value = false
        isFinishing.value = false
        if (signal?.aborted) notifyCancelled()
      }
    }
  }

  /**
   * The microphone or the provider failed mid-dictation; the text so far is
   * kept
   */
  function handleSessionError(error: Error) {
    if (voiceSession.signal?.aborted) return
    stopRecordingTimer()
    voiceSession.stopTimer()
    isStarted.value = false

    if (!hasText.value) {
      hasSession = false
      const message = describeVoiceError(error)
      if (message) toastText(message, 'error')
      else toastKey('toast.voiceRecognitionFailed', 'error')
      voiceSession.abort()
      notifyCancelled()
      return
    }

    toastText(
      `${describeVoiceError(error)}\n${t('menu.dictationInterrupted')}`,
      'error'
    )
  }

  async function startSession() {
    if (
      disposed ||
      isCancelling.value ||
      isStarted.value ||
      isFinishing.value ||
      starting
    )
      return
    transcript.value = createLiveTranscriptState()
    const generation = ++sessionGeneration
    starting = (async () => {
      try {
        await startDictation({
          onText: (state) => {
            if (generation === sessionGeneration) transcript.value = state
          },
          // a fast failure must not overtake the start it belongs to
          onError: (error) => {
            void Promise.resolve(starting).then(() => {
              if (generation === sessionGeneration) handleSessionError(error)
            })
          },
        })
        if (generation !== sessionGeneration) {
          await cancelDictation()
          return
        }
        voiceSession.begin()
        startRecordingTimer()
        hasSession = true
        isStarted.value = true
      } catch (error) {
        if (generation !== sessionGeneration) return
        const message = describeVoiceError(error)
        if (message) toastText(message, 'error')
        else toastKey('toast.voiceRecognitionFailed', 'error')
        voiceSession.abort()
        notifyCancelled()
      }
    })().finally(() => {
      starting = undefined
    })
    await starting
  }

  function dispose() {
    disposed = true
    restartGeneration += 1
    sessionGeneration += 1
    stopRecordingTimer()
    voiceSession.dispose()
    const stopping = cancelDictation()
    void (async () => {
      await stopping
      await starting
      await cancelDictation()
    })().catch(() => undefined)
  }

  async function restartSession() {
    const restart = ++restartGeneration
    notifyCancellation = false
    await cancelSession(false)
    if (disposed || restart !== restartGeneration) return
    await startSession()
  }
  return {
    transcript,
    isFinishing,
    isStarted,
    isTranscribing,
    audioLevel,
    audioPeak,
    recordingDurationMs,
    cancel,
    finish,
    startSession,
    restartSession,
    dispose,
    isStarting: () => Boolean(starting),
  }
}
