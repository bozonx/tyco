import {
  DESKTOP_EVENTS,
  type DialogConfig,
  type DialogRecording,
} from '@tyco/shared'
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
  buildDialogTurns,
  createDialogTranscript,
  type DialogSegment,
  type DialogSide,
} from '../lib/dialog/dialog-transcript'
import { buildSubtitlesView } from '../lib/dialog/dialog-subtitles'
import { createDialogTranslationQueue } from '../lib/dialog/dialog-translation'
import { desktopClient } from '../lib/desktop/client'
import { translate } from '../lib/i18n'
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
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useSecretsStore } from './secrets'
import { useTranslationStore } from './translation'

const DEFAULT_DIALOG_CONFIG: DialogConfig = {
  source: 'microphoneAndSystem',
  translationTargetLanguage: '',
  textDisplay: 'both',
  translationProvider: 'default',
}

/** The recording of the running session */
export interface DialogRecordingState {
  path: string
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
  const status = ref<DialogSessionStatus>('idle')
  const channelStatus = reactive<
    Partial<Record<DialogSide, DialogChannelStatus>>
  >({})
  const levels = reactive<Record<DialogSide, number>>({ me: 0, remote: 0 })
  const segments = shallowRef<readonly DialogSegment[]>([])
  const errorText = ref('')
  const canFixInSettings = ref(false)
  /** Whether the subtitles window is shown, with the main window minimized */
  const isSubtitlesShown = ref(false)
  /** Whether the running dialog records the microphone too */
  const hasMicrophone = ref(config.value.source === 'microphoneAndSystem')
  /** The file the running session is recorded to; none: not recorded */
  const recording = ref<DialogRecordingState>()

  const turns = computed(() => buildDialogTurns(segments.value))
  const isActive = computed(
    () => status.value === 'starting' || status.value === 'running'
  )

  let nextSegmentId = 0
  const transcript = createDialogTranscript({
    createId: () => `segment-${(nextSegmentId += 1)}`,
    onChange: (next) => {
      segments.value = next
    },
  })

  const translationClient = translationStore.createClient(() => {
    const provider = config.value.translationProvider
    return provider === 'default' ? undefined : provider
  })
  const translationQueue = createDialogTranslationQueue({
    targetLanguage: () => config.value.translationTargetLanguage,
    translate: async ({ text, targetLanguage, context, signal }) => {
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
  /** What the next capture is asked to record to, if anything */
  let recordingRequest: DialogRecording | undefined
  let recordingPath: string | undefined
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
              errorText.value = translate('dialog.recordingFailed')
              canFixInSettings.value = false
            },
          },
          desktopStore.userConfig.stt.microphoneId,
          recordingRequest
        )
        recordingPath = started.recordingPath
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
        if (recordingPath)
          recording.value = {
            path: recordingPath,
            startedAtMs: sessionStartedAtMs,
          }
        void dialogHistory.begin({
          startedAt: sessionStartedAtMs,
          source: hasMicrophone.value ? 'microphoneAndSystem' : 'system',
          ...(recordingPath && { recordingPath }),
        })
      }
      status.value = next
      if (next !== 'running') {
        levels.me = 0
        levels.remote = 0
        recording.value = undefined
      }
      if (next === 'idle' || next === 'failed') void dialogHistory.end()
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
   * A new session: the previous transcript goes, kept in the history when it is
   * on. `isRecording`: the session is also recorded to a file
   */
  async function start(options: { isRecording?: boolean } = {}) {
    if (isActive.value || isPreparing) return
    isPreparing = true
    errorText.value = ''
    canFixInSettings.value = false
    for (const side of ['me', 'remote'] as const) delete channelStatus[side]
    await dialogHistory.end()
    translationQueue.clear()
    transcript.clear()
    recordingRequest = options.isRecording
      ? {
          ...(config.value.recordingsFolder?.trim() && {
            folder: config.value.recordingsFolder.trim(),
          }),
        }
      : undefined
    recordingPath = undefined
    try {
      activeStt = await resolveDialogStt({
        getConfig: () => desktopStore.userConfig.stt,
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

  async function stop() {
    await session.stop()
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

  /** The transcript as text, with the translations when they are shown */
  function exportText(): string {
    return exportDialogTranscript(segments.value, {
      includeTranslation:
        Boolean(config.value.translationTargetLanguage) &&
        config.value.textDisplay !== 'original',
      labels: {
        me: translate('dialog.sideMe'),
        remote: translate('dialog.sideRemote'),
        translation: translate('dialog.translationLabel'),
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
  })
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
  onScopeDispose(() => {
    unregisterFlush()
    dialogHistory.dispose()
  })

  const subtitlesView = computed(() =>
    buildSubtitlesView({
      turns: turns.value,
      translationLanguage: config.value.translationTargetLanguage,
      textDisplay: config.value.textDisplay,
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
    await publishSubtitles()
    const result = await useIpcStore().callOrNotify('show_subtitles', {
      geometry: config.value.compactGeometry ?? null,
    })
    if (result.success) isSubtitlesShown.value = true
  }

  async function hideSubtitles() {
    if (!isSubtitlesShown.value) return
    isSubtitlesShown.value = false
    const result = await useIpcStore().callOrNotify('hide_subtitles')
    if (result.success && result.result)
      await updateConfig({ compactGeometry: result.result })
  }

  void desktopClient
    .listen(DESKTOP_EVENTS.SUBTITLES_ACTION_REQUESTED, (action) =>
      action === 'stop' ? stopAndExpand() : hideSubtitles()
    )
    .catch(() => undefined)

  return {
    config,
    status,
    channelStatus,
    levels,
    segments,
    turns,
    errorText,
    canFixInSettings,
    isActive,
    isSubtitlesShown,
    hasMicrophone,
    recording,
    start,
    stop,
    stopAndExpand,
    retryTranslation,
    acknowledgeRecordingNotice,
    exportText,
    updateConfig,
    copyTranscript,
    sendToActionMenu,
    showSubtitles,
    hideSubtitles,
  }
})
