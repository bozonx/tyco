import { errorMessage } from '@tyco/shared/value-guards'
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
  shouldInsertStyleDirectly?: () => boolean
  voiceCorrection: (text: string, signal?: AbortSignal) => Promise<string>
  voiceStyling?: (
    text: string,
    rule: string,
    signal?: AbortSignal
  ) => Promise<string>
  saveSource: (
    text: string,
    action: 'voiceCorrection'
  ) => Promise<string | null>
  saveSourceResult: (sourceId: string | null, text: string) => Promise<unknown>
  setPendingModal: (options: {
    correction?: boolean
    styling?: boolean
    transformation?: boolean
    label?: string
    allowBufferedIntent?: boolean
    onCancel: () => void
  }) => number
  clearPendingModal: (owner: number) => void
  consumeBufferedIntent?: () => 'insert' | 'copy' | null
  options: () => { chat?: boolean; prefix?: string; suffix?: string }
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
    return errorMessage(error)
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

  const finish = async (
    intent: VoiceFinishIntent = 'insert',
    options?: { styleRule?: string }
  ) => {
    if (isFinishing.value || isCancelling.value) {
      return
    }

    const generation = sessionGeneration
    let signal = voiceSession.signal
    const isCurrent = () => generation === sessionGeneration && !signal?.aborted
    isFinishing.value = true
    voiceSession.stopTimer()

    try {
      await starting
      // a start that was still running has armed the recording limit again
      voiceSession.stopTimer()
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
        const { chat, prefix = '', suffix = '' } = deps.options()
        if (chat && intent === 'submit' && `${prefix}${suffix}`.trim()) {
          deps.onCorrected('', '', undefined, 'submit')
          return
        }
        toastKey('toast.nothingRecognized', 'warn')
        notifyCancelled()
        return
      }

      let resultText = recognizedText
      let correctedText: string | undefined

      if (options?.styleRule && deps.voiceStyling) {
        if (!isCurrent()) return
        let sourceId: string | null = null
        try {
          sourceId = await deps.saveSource(recognizedText, 'voiceCorrection')
        } catch {
          // the text is still here; only its copy in the history is missing
          toastKey('history.operationFailed', 'error')
        }
        if (!isCurrent()) return
        const styling = new AbortController()
        const abortStyling = () => styling.abort()
        signal?.addEventListener('abort', abortStyling)
        const owner = deps.setPendingModal({
          styling: true,
          allowBufferedIntent: intent === 'next',
          onCancel: abortStyling,
        })

        try {
          const styledText = await deps.voiceStyling(
            recognizedText,
            options.styleRule,
            styling.signal
          )

          if (!isCurrent()) return
          if (!styling.signal.aborted && styledText.trim()) {
            resultText = styledText
            correctedText = styledText
            await deps.saveSourceResult(sourceId, styledText).catch(() => {
              toastKey('history.operationFailed', 'error')
            })
          }
        } catch {
          if (!isCurrent()) return
        } finally {
          signal?.removeEventListener('abort', abortStyling)
          deps.clearPendingModal(owner)
        }
      } else if (shouldFormatRecognizedText()) {
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
        // cancelling the correction keeps the recognized text as it is
        const correction = new AbortController()
        const abortCorrection = () => correction.abort()
        signal?.addEventListener('abort', abortCorrection)
        const owner = deps.setPendingModal({
          correction: true,
          allowBufferedIntent: intent === 'next',
          onCancel: abortCorrection,
        })

        try {
          const formattedText = await voiceCorrection(
            recognizedText,
            correction.signal
          )

          if (!isCurrent()) return
          // a reply that arrived after the user cancelled it is not used
          if (!correction.signal.aborted && formattedText.trim()) {
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
          signal?.removeEventListener('abort', abortCorrection)
          deps.clearPendingModal(owner)
        }
      }

      if (!isCurrent()) return
      const buffered = deps.consumeBufferedIntent?.()
      if (buffered && intent === 'next') {
        intent = buffered
      }
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
  const finishWithStyle = (rule: string) => {
    const intent: VoiceFinishIntent = deps.shouldInsertStyleDirectly?.()
      ? 'insert'
      : 'next'
    return finish(intent, { styleRule: rule })
  }

  return {
    transcript,
    isFinishing,
    isStarted,
    isTranscribing,
    cancel,
    finish,
    finishWithStyle,
    startSession,
    restartSession,
    dispose,
    isStarting: () => Boolean(starting),
  }
}
