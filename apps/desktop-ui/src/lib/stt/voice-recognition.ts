import { computed, ref } from 'vue'
import { createContextualCorrectionModel } from './contextual-correction'
import type { EditorHistoryEntry, EditorHistoryFailure } from '@tyco/shared'
import { historyFailureOf } from '../history/history-failure'
import { createInputHistorySession } from '../history/input-history-session'
import type { BufferedPendingAction } from '../modals/menu-modal-params'
import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'
import { describeDictationError } from './dictation-error'
import type { DictationTarget } from './dictation-target'
import type { LiveDictationStart } from './live-dictation'
import {
  createLiveTranscriptState,
  hasNewTranscriptSpeech,
  type LiveTranscriptState,
  liveTranscriptText,
} from './live-transcript'
import type { VoiceFinishIntent } from './voice-finish-intent'
import {
  AUTO_STOP_WARNING_MS,
  type AutoStopWarning,
  createVoiceSession,
  MAX_RECORDING_MS,
  SILENCE_TIMEOUT_MS,
} from './voice-session'

/**
 * How long the LLM may format or style a dictation; then the raw transcript
 * goes on as it is
 */
const DEFAULT_POST_PROCESS_TIMEOUT_MS = 30_000

/**
 * `promise`, or a rejection as soon as `signal` aborts: a hung request may
 * ignore it
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

export interface VoiceRecognitionDependencies extends TimerDependencies {
  startDictation: (
    handlers: Pick<LiveDictationStart, 'onText' | 'onError'>
  ) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  shouldFormatRecognizedText: () => boolean
  shouldCorrectContextually?: () => boolean
  contextualVoiceCorrection?: (
    text: string,
    signal: AbortSignal
  ) => Promise<unknown>
  shouldInsertStyleDirectly?: () => boolean
  voiceCorrection: (text: string, signal?: AbortSignal) => Promise<string>
  voiceStyling?: (
    text: string,
    rule: string,
    signal?: AbortSignal
  ) => Promise<string>
  createHistorySession?: () => ReturnType<typeof createInputHistorySession>
  saveCheckpoint?: (entry: EditorHistoryEntry) => Promise<string | null>
  saveSource: (
    text: string,
    action: 'voiceCorrection'
  ) => Promise<string | null>
  saveSourceResult: (sourceId: string | null, text: string) => Promise<unknown>
  /** Why the correction of the transcript `sourceId` produced nothing */
  saveSourceFailure?: (
    sourceId: string | null,
    failure: EditorHistoryFailure
  ) => Promise<unknown>
  /** The error text the user is shown, kept with a failed transcript */
  describeError?: (error: unknown) => string
  setPendingModal: (options: {
    correction?: boolean
    styling?: boolean
    transformation?: boolean
    label?: string
    cancelLabel?: string
    allowBufferedIntent?: boolean
    onCancel: () => void
  }) => number
  clearPendingModal: (owner: number) => void
  consumeBufferedIntent?: () => BufferedPendingAction | null
  postProcessTimeoutMs?: number
  now?: () => number
  options: () => {
    chat?: boolean
    inline?: boolean
    target?: DictationTarget
    prefix?: string
    suffix?: string
  }
  onCorrected: (
    result: string,
    recognized: string,
    corrected: string | undefined,
    intent: VoiceFinishIntent
  ) => void
  onCancelled: () => void
  /**
   * The dictation was going on or being finished when the recognition was
   * disposed, e.g. the window switched to another mode: the text so far, so
   * that the user can still take it. Not called after a cancellation
   */
  onAbandoned?: (text: string) => void
  /**
   * Called when starting or recording fails with no text.
   *
   * - `'keep'`: caller renders the error inline (skips toast and `onCancelled`).
   * - `'handled'`: caller already notified the user (skips default toast).
   */
  onStartError?: (error: unknown, message: string) => 'keep' | 'handled' | void
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
  const postProcessTimeoutMs =
    deps.postProcessTimeoutMs ?? DEFAULT_POST_PROCESS_TIMEOUT_MS

  /** Why the correction of the transcript `sourceId` produced nothing */
  const saveFailure = async (
    sourceId: string | null,
    error: unknown,
    status: { isTimedOut: boolean; isCancelled: boolean }
  ) => {
    if (!deps.saveSourceFailure || !sourceId) return
    const failure: EditorHistoryFailure = status.isTimedOut
      ? { kind: 'timeout' }
      : historyFailureOf(
          error,
          error === undefined ? undefined : deps.describeError?.(error),
          status.isCancelled
        )
    await deps.saveSourceFailure(sourceId, failure).catch(() => {
      toastKey('history.operationFailed', 'error')
    })
  }
  const transcript = ref(createLiveTranscriptState())
  const hasText = computed(() => Boolean(liveTranscriptText(transcript.value)))
  const isFinishing = ref(false)
  const isCancelling = ref(false)
  const isStarted = ref(false)
  const isTranscribing = ref(false)
  const isCorrecting = ref(false)
  const isStyling = ref(false)
  let sessionGeneration = 0
  let starting: Promise<void> | undefined
  let cancelling: Promise<void> | undefined
  let notifyCancellation = false
  let restartGeneration = 0
  let disposed = false
  /** Set once a dictation started; it stays finishable after a failure */
  let hasSession = false
  let lastRawState: LiveTranscriptState = createLiveTranscriptState()
  /** The best text of the dictation being finished: raw, then processed */
  let finishingText = ''
  let contextual: ReturnType<typeof createContextualCorrectionModel> | undefined
  const historySession =
    deps.createHistorySession?.() ??
    (deps.saveCheckpoint
      ? createInputHistorySession({
          save: deps.saveCheckpoint,
          reportError: () => toastKey('history.operationFailed', 'error'),
        })
      : undefined)
  const autoStopWarning = ref<AutoStopWarning>()

  const voiceSession = createVoiceSession({
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
      toastKey(
        reason === 'silence'
          ? 'toast.recordingSilenceStop'
          : 'toast.recordingLimitReached',
        'warn'
      )
      // An unattended stop must not type into the focused external window or
      // send a half-spoken chat prompt on its own.
      void finish('next')
    },
  })

  /** What went wrong, in the words of the user's language where they are ours */
  function describeVoiceError(error: unknown): string {
    return describeDictationError(error, t)
  }

  /** The session `onCancelled` was last told about: it is told once */
  let cancelledGeneration: number | undefined

  function notifyCancelled() {
    if (cancelledGeneration === sessionGeneration) return
    cancelledGeneration = sessionGeneration
    deps.onCancelled()
  }

  const cancelSession = (notify: boolean): Promise<void> => {
    notifyCancellation ||= notify
    if (cancelling) return cancelling
    isCancelling.value = true
    historySession?.end()
    sessionGeneration += 1
    hasSession = false
    voiceSession.abort()
    contextual?.cancel()

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
        isCorrecting.value = false
        isStyling.value = false
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
    contextual?.markFinishing()

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
      isStarted.value = false
      isTranscribing.value = true
      // the provider's last words arrive after the microphone is off
      const recognizedText = await finishDictation()
      if (!isCurrent()) return
      finishingText = recognizedText
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
      let postProcessAborted = false

      // the raw transcript is the only copy of what was said: the LLM may
      // distort it, the insertion may fail, and it cannot be dictated the
      // same way twice
      let sourceId: string | null = null
      try {
        sourceId = historySession
          ? await historySession.complete(
              recognizedText,
              'source',
              'voiceCorrection'
            )
          : await deps.saveSource(recognizedText, 'voiceCorrection')
      } catch {
        // the text is still here; only its copy in the history is missing
        toastKey('history.operationFailed', 'error')
      }
      if (!isCurrent()) return

      const styleRule = options?.styleRule
      const voiceStyling = deps.voiceStyling
      const correctContextually = contextual
      const postProcess =
        styleRule && voiceStyling
          ? {
              pending: { styling: true },
              run: (postSignal: AbortSignal) =>
                (async () => {
                  const text = correctContextually
                    ? await correctContextually.finish(
                        recognizedText,
                        postSignal
                      )
                    : recognizedText
                  if (postSignal.aborted) return text
                  return voiceStyling(text, styleRule, postSignal)
                })(),
            }
          : correctContextually
            ? {
                pending: { correction: true },
                run: (postSignal: AbortSignal) =>
                  correctContextually.finish(recognizedText, postSignal),
              }
            : shouldFormatRecognizedText()
              ? {
                  pending: { correction: true },
                  run: (postSignal: AbortSignal) =>
                    voiceCorrection(recognizedText, postSignal),
                }
              : null

      if (postProcess) {
        if ('styling' in postProcess.pending && postProcess.pending.styling) {
          isStyling.value = true
        } else {
          isCorrecting.value = true
        }
        // Explicit cancellation stops delivery; the source is already in history.
        const controller = new AbortController()
        const abortPostProcess = () => {
          controller.abort()
          contextual?.cancel()
        }
        signal?.addEventListener('abort', abortPostProcess)
        const canBufferPostProcessIntent =
          intent === 'next' ||
          (!deps.options().inline && deps.options().target !== 'editor')
        const owner = deps.setPendingModal({
          ...postProcess.pending,
          cancelLabel: t('common.cancel'),
          allowBufferedIntent: canBufferPostProcessIntent,
          onCancel: () => {
            void cancel()
          },
        })
        // a dead connection must not hold the dictated text for minutes
        let isTimedOut = false
        const timeout = createSingleTimer(deps)
        timeout.start(() => {
          isTimedOut = true
          controller.abort()
          contextual?.cancel()
        }, postProcessTimeoutMs)

        try {
          const processedText = await untilAborted(
            postProcess.run(controller.signal),
            controller.signal
          )

          if (!isCurrent()) return
          // a reply that arrived after the user cancelled it is not used
          if (!controller.signal.aborted && processedText.trim()) {
            resultText = processedText
            correctedText = processedText
            finishingText = processedText
            await deps.saveSourceResult(sourceId, processedText).catch(() => {
              toastKey('history.operationFailed', 'error')
            })
          } else {
            await saveFailure(sourceId, undefined, {
              isTimedOut,
              isCancelled: controller.signal.aborted,
            })
          }
        } catch (error) {
          // the request has told the failure; keep available contextual text
          if (!isCurrent()) return
          if (correctContextually && correctContextually.text.trim()) {
            resultText = correctContextually.text
            correctedText = correctContextually.text
            await deps.saveSourceResult(sourceId, resultText).catch(() => {
              toastKey('history.operationFailed', 'error')
            })
          } else {
            await saveFailure(sourceId, error, {
              isTimedOut,
              isCancelled: controller.signal.aborted,
            })
          }
        } finally {
          isCorrecting.value = false
          isStyling.value = false
          timeout.stop()
          // a timeout is not the user's choice: a buffered intent still holds
          postProcessAborted = controller.signal.aborted && !isTimedOut
          signal?.removeEventListener('abort', abortPostProcess)
          deps.clearPendingModal(owner)
        }
        if (isTimedOut && isCurrent()) {
          toastKey('toast.voicePostProcessTimeout', 'warn')
        }
      }

      if (!isCurrent()) return
      const buffered = deps.consumeBufferedIntent?.()
      if (
        buffered &&
        (intent === 'next' ||
          (!deps.options().inline && deps.options().target !== 'editor')) &&
        !postProcessAborted
      ) {
        intent = buffered
      }
      finishingText = ''
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
        contextual?.cancel()
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
    historySession?.checkpoint()
    isStarted.value = false

    if (!hasText.value) {
      hasSession = false
      const message = describeVoiceError(error)
      voiceSession.abort()
      const outcome = deps.onStartError?.(
        error,
        message || t('toast.voiceRecognitionFailed')
      )
      if (outcome === 'keep') return
      if (outcome !== 'handled') {
        if (message) toastText(message, 'error')
        else toastKey('toast.voiceRecognitionFailed', 'error')
      }
      notifyCancelled()
      return
    }

    // while finishing, the text heard so far is already on its way: the
    // choice between keeping and dropping it is no longer the user's
    toastText(
      isFinishing.value
        ? describeVoiceError(error)
        : `${describeVoiceError(error)}\n${t('menu.dictationInterrupted')}`,
      'error'
    )
  }

  async function startSession() {
    // a session that broke keeps its text until it is finished or cancelled:
    // starting over, e.g. when the window is shown again, would drop it
    if (
      disposed ||
      isCancelling.value ||
      isStarted.value ||
      isFinishing.value ||
      hasSession ||
      starting
    )
      return
    historySession?.end()
    historySession?.update('')
    transcript.value = createLiveTranscriptState()
    lastRawState = createLiveTranscriptState()
    finishingText = ''
    const generation = ++sessionGeneration
    let hasReportedContextualError = false
    contextual?.cancel()
    contextual =
      deps.shouldCorrectContextually?.() && deps.contextualVoiceCorrection
        ? createContextualCorrectionModel({
            request: deps.contextualVoiceCorrection,
            timeoutMs: postProcessTimeoutMs,
            onText: (text) => {
              if (generation !== sessionGeneration) return
              transcript.value = { ...transcript.value, committed: text }
            },
            onError: () => {
              if (
                generation === sessionGeneration &&
                !hasReportedContextualError
              ) {
                hasReportedContextualError = true
                toastKey('toast.voiceContextualCorrectionFailed', 'error')
              }
            },
          })
        : undefined
    starting = (async () => {
      try {
        await startDictation({
          onText: (state) => {
            if (generation !== sessionGeneration) return
            transcript.value = {
              ...state,
              committed: contextual?.text ?? state.committed,
            }
            contextual?.update(state.committed)
            historySession?.update(liveTranscriptText(state))
            // empty results come in silence too: only new words are speech
            if (hasNewTranscriptSpeech(lastRawState, state)) {
              voiceSession.markActivity()
            }
            lastRawState = state
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
        voiceSession.abort()
        contextual?.cancel()
        const outcome = deps.onStartError?.(
          error,
          message || t('toast.voiceRecognitionFailed')
        )
        if (outcome === 'keep') return
        if (outcome !== 'handled') {
          if (message) toastText(message, 'error')
          else toastKey('toast.voiceRecognitionFailed', 'error')
        }
        notifyCancelled()
      }
    })().finally(() => {
      starting = undefined
    })
    await starting
  }

  function dispose() {
    // a dictation nobody cancelled is not dropped silently; a cancelled or
    // delivered one has no session and no text in finishing
    const abandonedText = isFinishing.value
      ? finishingText || liveTranscriptText(transcript.value)
      : hasSession
        ? liveTranscriptText(transcript.value)
        : ''
    finishingText = ''
    if (abandonedText.trim() && !isCancelling.value)
      deps.onAbandoned?.(abandonedText)
    historySession?.dispose()
    disposed = true
    restartGeneration += 1
    sessionGeneration += 1
    voiceSession.dispose()
    contextual?.cancel()
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
    cancelWithoutClosing: () => cancelSession(false),
    flushHistory: () => historySession?.flush() ?? Promise.resolve(null),
    transcript,
    autoStopWarning,
    isFinishing,
    isStarted,
    isTranscribing,
    isCorrecting,
    isStyling,
    cancel,
    finish,
    finishWithStyle,
    startSession,
    restartSession,
    dispose,
    isStarting: () => Boolean(starting),
  }
}
