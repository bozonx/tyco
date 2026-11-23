import { DESKTOP_EVENTS, type DialogConfig } from '@tyco/shared'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'

import { exportDialogTranscript } from '../lib/dialog/dialog-export'
import { createDialogHistory } from '../lib/dialog/dialog-history'
import {
  createDialogSession,
  type DialogChannelStatus,
  type DialogSessionStatus,
} from '../lib/dialog/dialog-session'
import { resolveDialogStt, type DialogStt } from '../lib/dialog/dialog-stt'
import {
  buildDialogFeedItems,
  buildDialogTurns,
  createDialogTranscript,
  type DialogFeedItem,
  type DialogSegment,
  type DialogSessionBreak,
  type DialogSide,
} from '../lib/dialog/dialog-transcript'
import { buildSubtitlesView } from '../lib/dialog/dialog-subtitles'
import { createDialogTranslationQueue } from '../lib/dialog/dialog-translation'
import { desktopClient } from '../lib/desktop/client'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig, taskModel } from '../lib/llm/llm-config'
import { clientLogger } from '../lib/logger'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import {
  asDictationError,
  describeDictationError,
  isSettingsFixableDictationError,
} from '../lib/stt/dictation-error'
import { createSttClient } from '../lib/stt/stt-client'
import { createVoiceCaptureControl } from '../lib/stt/voice-capture'
import { useDesktopStore } from './desktop'
import { useDialogStatusStore } from './dialog-status'
import { useHistoryStore } from './history'
import { useVisibleWorkStore } from './visible-work'
import { useIpcStore } from './ipc'
import { useSecretsStore } from './secrets'
import { useTranslationStore } from './translation'

const DEFAULT_DIALOG_CONFIG: DialogConfig = {
  isEnabled: false,
  source: 'microphoneAndSystem',
  translationTargetLanguage: '',
  isTranslationOnly: false,
  isRecordingMixedDown: false,
  isRecordingProcessed: true,
}

/** The recording of the running session */
export interface DialogRecordingState {
  /** The file name in the recordings of the history */
  file: string
  /** Unix time in milliseconds */
  startedAtMs: number
}

/**
 * The dialog: a long transcription of a call that runs in the background until
 * it is stopped, whatever tab the main window shows. Every start begins a new
 * session: a fresh transcript and, with the history on, an entry of its own.
 */
export const useDialogStore = defineStore('dialog', () => {
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
  const historyStore = useHistoryStore()
  const translationStore = useTranslationStore()

  const config = computed<DialogConfig>(() => ({
    ...DEFAULT_DIALOG_CONFIG,
    ...desktopStore.userConfig?.dialog,
  }))
  const isEnabled = computed(() => config.value.isEnabled)
  /** The model that translates the other side; none: nothing is translated */
  const translationModel = computed(() =>
    taskModel(
      normalizeLlmConfig(desktopStore.userConfig?.llm),
      'dialogTranslation'
    )
  )
  const status = ref<DialogSessionStatus>('idle')
  const channelStatus = reactive<
    Partial<Record<DialogSide, DialogChannelStatus>>
  >({})
  const levels = reactive<Record<DialogSide, number>>({ me: 0, remote: 0 })
  const segments = shallowRef<readonly DialogSegment[]>([])
  const sessionBreaks = ref<DialogSessionBreak[]>([])
  const errorText = ref('')
  const canFixInSettings = ref(false)
  /** Whether the subtitles window is shown, with the main window minimized */
  const isSubtitlesShown = ref(false)
  /** Whether the running dialog records the microphone too */
  const hasMicrophone = ref(config.value.source === 'microphoneAndSystem')
  /** The file the running session is recorded to; none: not recorded */
  const recording = ref<DialogRecordingState>()
  /** Whether the next session run will be recorded to an audio file */
  const isRecordEnabled = ref(false)

  const turns = computed(() => buildDialogTurns(segments.value))
  const feedItems = computed<DialogFeedItem[]>(() =>
    buildDialogFeedItems(turns.value, sessionBreaks.value)
  )
  const isActive = computed(
    () => status.value === 'starting' || status.value === 'running'
  )
  const dialogStatus = useDialogStatusStore()
  watch(
    isActive,
    (next) => {
      dialogStatus.isActive = next
    },
    { immediate: true }
  )
  watch(
    () => Boolean(recording.value),
    (isRecording) => {
      dialogStatus.isRecording = isRecording
      void useIpcStore()
        .call('set_tray_recording', {
          isRecording,
          tooltipLabel: isRecording
            ? translate('tray.recordingTooltip')
            : translate('tray.tooltip'),
        })
        .catch((error: unknown) =>
          clientLogger.warn(
            `Could not update tray recording state: ${String(error)}`,
            'dialog'
          )
        )
    },
    { immediate: true }
  )

  let nextSegmentId = 0
  const transcript = createDialogTranscript({
    createId: () => `segment-${(nextSegmentId += 1)}`,
    onChange: (next) => {
      segments.value = next
    },
  })

  // a live call is translated a line at a time, with the lines before it as
  // context, which only a model reads; a review pass would double the delay
  const translationClient = translationStore.createClient({
    task: 'dialogTranslation',
    overrides: { provider: 'llm', qualityGate: 'off' },
  })
  const translationQueue = createDialogTranslationQueue({
    targetLanguage: () => config.value.translationTargetLanguage,
    translate: async ({ text, targetLanguage, context, signal }) => {
      const userRule =
        desktopStore.userConfig.llm?.tasks.dialogTranslation?.rule.trim()
      const rules = [
        'The text is what the other side of a live call said, recognized from speech.',
        ...(context.length
          ? [
              'The lines said before it, for context only; do not translate them:',
              ...context.map(
                (line) =>
                  `- ${line.side === 'me' ? 'Me' : 'Other side'}: ${line.text}`
              ),
            ]
          : []),
        ...(userRule ? [userRule] : []),
      ].join('\n')
      const result = await translationClient.translate(text, {
        targetLanguage,
        signal,
        rules,
      })
      return result.text
    },
    onUpdate: (id, patch) => transcript.update(id, patch),
    logError: (message, error) =>
      clientLogger.warn(`${message}: ${String(error)}`, 'dialog'),
  })

  const capture = createVoiceCaptureControl(tauriNetIpc)
  const stt = createSttClient({ transport: createTauriTransport(tauriNetIpc) })
  let activeStt: DialogStt | undefined
  /** Whether the next capture is asked to record to a file */
  let isRecordingRequested = false
  let recordingFile: string | undefined
  /** The recording stopped before the session ran: its entry says so */
  let isRecordingFailedEarly = false
  /** The history entry of the session names `recordingFile` */
  let isRecordingLinked = false
  /**
   * When the running session began recording: the segments are on the clock, so
   * the turns of several sessions without a clear stay in order
   */
  let sessionStartedAtMs = 0

  const showError = (error: unknown) => {
    errorText.value = describeDictationError(error, translate)
    canFixInSettings.value = isSettingsFixableDictationError(error)
  }

  const session = createDialogSession({
    capture: {
      start: async (source) => {
        const started = await capture.start(
          source,
          {
            onRecordingFailed: (message) => {
              clientLogger.warn(
                `Dialog recording stopped: ${message}`,
                'dialog'
              )
              recording.value = undefined
              isRecordEnabled.value = false
              errorText.value = translate('dialog.recordingFailed')
              canFixInSettings.value = false
              if (isRecordingLinked)
                void dialogHistory.markRecordingIncomplete()
              else isRecordingFailedEarly = true
            },
          },
          desktopStore.userConfig.stt.microphoneId,
          isRecordingRequested
        )
        recordingFile = started.recordingFile
        return started
      },
      stop: () => capture.stop(),
    },
    transcribe: ({ side, audio, sampleRate, signal }) => {
      const resolved = activeStt!
      return stt.transcribeLive({
        model: resolved.model,
        audio,
        sampleRate,
        language: resolved.languageOf(side),
        hasApiKey: resolved.hasApiKey,
        isContinuous: true,
        signal,
      })
    },
    onStatus: (next) => {
      if (next === 'running') {
        sessionStartedAtMs = Date.now()
        if (recordingFile && !isRecordingFailedEarly) {
          recording.value = {
            file: recordingFile,
            startedAtMs: sessionStartedAtMs,
          }
          isRecordEnabled.value = true
        }
        isRecordingLinked = Boolean(recordingFile)
        const isRecorded = Boolean(recordingFile && !isRecordingFailedEarly)
        const isFirstRun =
          segments.value.length === 0 && sessionBreaks.value.length === 0

        if (isFirstRun) {
          sessionBreaks.value = [
            {
              id: `break-${Date.now()}`,
              timestampMs: sessionStartedAtMs,
              isRecording: isRecorded,
              recordingFile: isRecorded ? recordingFile : undefined,
              action: 'started',
            },
          ]
          void dialogHistory.begin({
            startedAt: sessionStartedAtMs,
            source: hasMicrophone.value ? 'microphoneAndSystem' : 'system',
            ...(recordingFile && {
              recordingFile,
              recordingFiles: [recordingFile],
            }),
            ...(recordingFile &&
              isRecordingFailedEarly && { isRecordingIncomplete: true }),
          })
        } else {
          const hadRecordingBefore = sessionBreaks.value.some(
            (b) => b.isRecording
          )
          const action = isRecorded && !hadRecordingBefore ? 'started' : 'resumed'
          sessionBreaks.value.push({
            id: `break-${Date.now()}`,
            timestampMs: sessionStartedAtMs,
            isRecording: isRecorded,
            recordingFile: isRecorded ? recordingFile : undefined,
            action,
          })
          if (recordingFile) {
            void dialogHistory.addRecording(recordingFile)
          }
        }
      }
      status.value = next
      if (next !== 'running') {
        levels.me = 0
        levels.remote = 0
        recording.value = undefined
      }
      if (next === 'idle' || next === 'failed') {
        void dialogHistory.checkpoint()
        discardUnlinkedRecording()
      }
    },
    onCaptureAbandoned: () => discardUnlinkedRecording(),
    onAudioDropped: (side, droppedMs) => {
      clientLogger.warn(
        `Dialog ${side} channel dropped ${Math.round(droppedMs)} ms of audio its speech provider did not read`,
        'dialog'
      )
    },
    onChannelStatus: (side, next) => {
      channelStatus[side] = next
    },
    onPart: (side, part, offsetMs) => {
      const settled = transcript.apply(
        side,
        part,
        sessionStartedAtMs + offsetMs
      )
      if (settled) translationQueue.enqueue(settled)
    },
    onDraftLost: (side) => transcript.dropDraft(side),
    onError: (error, failure) => {
      const dictationError = asDictationError(
        failure.isFatal ? 'microphoneLost' : 'provider',
        error
      )
      clientLogger.warn(
        `Dialog ${failure.isFatal ? 'stopped' : `channel ${failure.side} stopped`}: ${String(error)}`,
        'dialog'
      )
      showError(dictationError)
    },
    isPermanentError: (error) => {
      const kind = asDictationError('provider', error).kind
      return kind === 'auth' || kind === 'incompleteConfig'
    },
  })

  void desktopClient
    .listen(DESKTOP_EVENTS.VOICE_AUDIO_LEVEL, (payload) => {
      if (status.value !== 'running') return
      if (payload.channels && payload.channels.length >= 2) {
        levels.me = payload.channels[0]
        levels.remote = payload.channels[1]
      } else {
        levels.remote = payload.level
      }
    })
    .catch(() => undefined)

  let isPreparing = false

  /**
   * A session stopped while it started never got an entry: its recording,
   * closed by now, would wait unnamed for days
   */
  function discardUnlinkedRecording() {
    const file = recordingFile
    if (!file || isRecordingLinked) return
    recordingFile = undefined
    void useIpcStore()
      .call('discard_dialog_recording', { file })
      .then((result) => {
        if (!result.success)
          clientLogger.warn(
            `Could not remove an unused dialog recording: ${result.error}`,
            'dialog'
          )
      })
  }

  /**
   * Starts or resumes a dialog session. `isRecording`: whether this run is also
   * recorded to an audio file. If omitted, uses `isRecordEnabled.value`.
   */
  async function start(options: { isRecording?: boolean } = {}) {
    if (isActive.value || isPreparing) return
    isPreparing = true
    errorText.value = ''
    canFixInSettings.value = false
    for (const side of ['me', 'remote'] as const) delete channelStatus[side]
    isRecordingRequested = options.isRecording ?? isRecordEnabled.value
    isRecordEnabled.value = isRecordingRequested
    recordingFile = undefined
    isRecordingFailedEarly = false
    isRecordingLinked = false
    try {
      activeStt = await resolveDialogStt({
        getConfig: () => desktopStore.userConfig.stt,
        getRemoteLanguage: () => config.value.remoteLanguage,
        getOwnLanguage: () => config.value.ownLanguage,
        refreshSecrets: secretsStore.refreshSecrets,
        getSecrets: () => secretsStore.secrets,
        translate,
      })
      hasMicrophone.value = config.value.source === 'microphoneAndSystem'
      await session.start({ isMicrophoneEnabled: hasMicrophone.value })
    } catch (error) {
      showError(asDictationError('microphone', error))
    } finally {
      isPreparing = false
    }
  }

  /** Clears the current transcript and closes the history session. */
  async function clear() {
    if (isActive.value) return
    await dialogHistory.end()
    translationQueue.clear()
    transcript.clear()
    sessionBreaks.value = []
    errorText.value = ''
    canFixInSettings.value = false
    isRecordEnabled.value = false
  }

  async function stop() {
    await session.stop()
  }

  /** Stops a running dialog and resolves once its transcript is in the history */
  async function stopAndSave() {
    if (!isActive.value) return
    await session.stop()
    await dialogHistory.end()
  }

  /** The subtitles have nothing to show once stopped: the window comes back */
  async function stopAndExpand() {
    await Promise.all([session.stop(), hideSubtitles()])
  }

  function retryTranslation(id: string) {
    const segment = segments.value.find((item) => item.id === id)
    if (segment?.translationState === 'failed') translationQueue.retry(segment)
  }

  /** The user was told to ask the other side before a recording */
  async function acknowledgeRecordingNotice() {
    await updateConfig({ isRecordingNoticeAcknowledged: true })
  }

  /** The user was told to use headphones to avoid echo during a call */
  async function acknowledgeHeadphonesNotice() {
    await updateConfig({ isHeadphonesNoticeAcknowledged: true })
  }

  /** The transcript as text, with the translations when there are any */
  function exportText(): string {
    return exportDialogTranscript(segments.value, {
      includeTranslation: Boolean(config.value.translationTargetLanguage),
      breaks: sessionBreaks.value,
      labels: {
        me: translate('dialog.sideMe'),
        remote: translate('dialog.sideRemote'),
        translation: translate('dialog.translationLabel'),
        sessionResumed: translate('dialog.sessionResumedListening'),
        sessionResumedRecording: translate('dialog.sessionResumedRecording'),
        sessionStartedListening: translate('dialog.sessionStartedListening'),
        sessionStartedRecording: translate('dialog.sessionStartedRecording'),
        sessionResumedListening: translate('dialog.sessionResumedListening'),
      },
    })
  }

  async function updateConfig(patch: Partial<DialogConfig>) {
    await desktopStore.updateUserConfig({
      dialog: { ...config.value, ...patch },
    })
  }

  async function copyTranscript() {
    return useIpcStore().callOrNotify('copy_text', { text: exportText() })
  }

  /** The transcript goes to the action menu as if it were selected text */
  async function sendToActionMenu() {
    return useIpcStore().callOrNotify('activate_mode', {
      mode: 'selectionActions',
      text: exportText(),
    })
  }

  const dialogHistory = createDialogHistory({
    save: historyStore.saveEditorHistory,
    getText: exportText,
    reportError: (error) =>
      clientLogger.warn(
        `Could not save the dialog to the history: ${String(error)}`,
        'dialog'
      ),
    onRecordingUnlinked: () => {
      errorText.value = translate('dialog.recordingNotInHistory')
      canFixInSettings.value = false
    },
  })
  // a history no longer kept on disk loses the entry that names the file
  watch(
    () => desktopStore.userConfig.editor.history.storage === 'disk',
    (isOnDisk) => {
      if (!isOnDisk) isRecordEnabled.value = false
      if (isOnDisk || !recording.value) return
      errorText.value = translate('dialog.recordingNotInHistory')
      canFixInSettings.value = false
    }
  )
  // the turns so far reach the history when the window hides and on quit
  watch(
    () => desktopStore.desktopState.isWindowShown,
    (isShown) => {
      if (!isShown) void dialogHistory.checkpoint()
    }
  )
  const unregisterFlush = historyStore.registerInputFlush(() =>
    dialogHistory.checkpoint()
  )
  // an external request stops a running dialog; the transcript is saved first
  const unregisterVisibleWork = useVisibleWorkStore().register(stopAndSave)
  // turning the mode off ends a running dialog with its transcript saved
  watch(isEnabled, (isOn) => {
    if (isOn) return
    void Promise.all([stopAndSave(), hideSubtitles()])
  })
  onScopeDispose(() => {
    unregisterFlush()
    unregisterVisibleWork()
    dialogHistory.dispose()
    if (recording.value) {
      void useIpcStore()
        .call('set_tray_recording', {
          isRecording: false,
          tooltipLabel: translate('tray.tooltip'),
        })
        .catch(() => undefined)
    }
  })

  const subtitlesView = computed(() =>
    buildSubtitlesView({
      turns: turns.value,
      translationLanguage: config.value.translationTargetLanguage,
      isTranslationOnly: config.value.isTranslationOnly,
      isActive: isActive.value,
      errorText: errorText.value,
      recordingStartedAtMs: recording.value?.startedAtMs,
      labels: {
        waitingForSpeech: translate('dialog.waitingForSpeech'),
        notRunning: translate('dialog.notRunning'),
        stop: translate('dialog.stopAndExpand'),
        expand: translate('dialog.expand'),
        recording: translate('dialog.recording'),
      },
    })
  )

  const publishSubtitles = () =>
    useIpcStore().call('publish_subtitles', { view: subtitlesView.value })

  // the subtitles window renders what the dialog publishes while it is shown
  watch(subtitlesView, () => {
    if (isSubtitlesShown.value) void publishSubtitles()
  })

  async function showSubtitles() {
    if (!isActive.value) return
    await publishSubtitles()
    const result = await useIpcStore().callOrNotify('show_subtitles', {
      geometry: config.value.compactGeometry ?? null,
    })
    if (result.success) isSubtitlesShown.value = true
  }

  let isHidingSubtitles = false

  async function hideSubtitles() {
    if (!isSubtitlesShown.value || isHidingSubtitles) return
    isHidingSubtitles = true
    try {
      const result = await useIpcStore().callOrNotify('hide_subtitles')
      // a window that did not hide is still shown and still updated
      if (!result.success) return
      isSubtitlesShown.value = false
      if (result.result) await updateConfig({ compactGeometry: result.result })
    } finally {
      isHidingSubtitles = false
    }
  }

  void desktopClient
    .listen(DESKTOP_EVENTS.SUBTITLES_ACTION_REQUESTED, (action) =>
      action === 'stop' ? stopAndExpand() : hideSubtitles()
    )
    .catch(() => undefined)

  return {
    isEnabled,
    config,
    translationModel,
    status,
    channelStatus,
    levels,
    segments,
    turns,
    feedItems,
    errorText,
    canFixInSettings,
    isActive,
    isSubtitlesShown,
    hasMicrophone,
    recording,
    isRecordEnabled,
    start,
    clear,
    stop,
    stopAndSave,
    stopAndExpand,
    retryTranslation,
    acknowledgeRecordingNotice,
    acknowledgeHeadphonesNotice,
    exportText,
    updateConfig,
    copyTranscript,
    sendToActionMenu,
    showSubtitles,
    hideSubtitles,
  }
})
