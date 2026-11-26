import {
  DESKTOP_EVENTS,
  type Dialog,
  type DialogConfig,
  type DialogSource,
} from '@tyco/shared'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { exportDialogTranscript } from '../lib/dialog/dialog-export'
import { createDialogHistory } from '../lib/dialog/dialog-history'
import { isDialogHistoryEnabled } from '../lib/dialog/dialog-history-storage'
import { createDialogId } from '../lib/dialog/dialog-id'
import {
  formatSelectedTurns,
  selectRangeUpTo,
  toggleShiftTurnSelection,
  toggleSingleTurnSelection,
} from '../lib/dialog/dialog-selection'
import {
  createDialogSession,
  type DialogChannelStatus,
  type DialogSessionStatus,
} from '../lib/dialog/dialog-session'
import { resolveDialogStt, type DialogStt } from '../lib/dialog/dialog-stt'
import { buildSubtitlesView } from '../lib/dialog/dialog-subtitles'
import {
  buildDialogFeedItems,
  buildDialogTurns,
  createDialogTranscript,
  turnText,
  turnTranslation,
  type DialogFeedItem,
  type DialogSegment,
  type DialogSessionBreak,
  type DialogSide,
  type DialogTurn,
} from '../lib/dialog/dialog-transcript'
import { createDialogTranslationQueue } from '../lib/dialog/dialog-translation'
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
import { appNavigation } from '../navigation'
import { useChatInputStore } from './chat-input'
import { useDialogHistoryStore } from './dialog-history'
import { useDialogStatusStore } from './dialog-status'
import { useHistoryStore } from './history'
import { useIpcStore } from './ipc'
import { useSecretsStore } from './secrets'
import { useToastStore } from './toast'
import { useTranslationStore } from './translation'
import { useVisibleWorkStore } from './visible-work'

const DEFAULT_DIALOG_CONFIG: DialogConfig = {
  isEnabled: false,
  source: 'microphoneAndSystem',
  history: { storage: 'disk' },
  translationTargetLanguage: '',
  isTranslationOnly: false,
  isRecordingMixedDown: false,
  isRecordingProcessed: true,
  selectionIncludeMe: true,
  selectionUseTranslation: false,
  isHistoryOpen: false,
}

/** The recording of the running session */
export interface DialogRecordingState {
  /** The file name inside `dialogs/recordings/<dialogId>/` */
  file: string
  /** Unix time in milliseconds */
  startedAtMs: number
}

/**
 * The dialog: a long transcription of a call that runs in the background until
 * it is stopped, whatever tab the main window shows. Each conversation has its
 * own id (`dialogs/<id>.json`) and its own audio folder
 * (`dialogs/recordings/<id>/`) and can be reopened from history.
 */
export const useDialogStore = defineStore('dialog', () => {
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
  const historyStore = useHistoryStore()
  const dialogHistoryStore = useDialogHistoryStore()
  const translationStore = useTranslationStore()

  const config = computed<DialogConfig>(() => ({
    ...DEFAULT_DIALOG_CONFIG,
    ...desktopStore.userConfig?.dialog,
    history: {
      ...DEFAULT_DIALOG_CONFIG.history,
      ...desktopStore.userConfig?.dialog?.history,
    },
  }))
  const isEnabled = computed(() => config.value.isEnabled)
  const isHistoryEnabled = computed(() =>
    isDialogHistoryEnabled(desktopStore.userConfig)
  )
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
  /** The id of the current or loaded dialog; null on a clean slate */
  const currentDialogId = ref<string | null>(null)
  /** Optional custom title of the current or loaded dialog */
  const currentDialogTitle = ref('')
  /** Source of the current or loaded dialog (falls back to config when empty) */
  const currentDialogSource = ref<DialogSource | null>(null)
  /** Translation language of a loaded dialog (falls back to config when empty) */
  const currentTranslationLanguage = ref<string | null>(null)
  /** Recordings of the current dialog that stopped early */
  const incompleteRecordingFiles = ref<string[]>([])
  /** Whether each recording file of the current dialog exists on disk */
  const recordingExists = ref<Record<string, boolean>>({})
  /** Whether the history sidebar panel is open in DialogView */
  const isHistoryOpen = computed({
    get: () => config.value.isHistoryOpen ?? false,
    set: (value: boolean) => {
      void updateConfig({ isHistoryOpen: value })
    },
  })
  /** Whether the running dialog records the microphone too */
  const hasMicrophone = ref(config.value.source === 'microphoneAndSystem')
  /** The file the running session is recorded to; none: not recorded */
  const recording = ref<DialogRecordingState>()
  /** Whether the next session run will be recorded to an audio file */
  const isRecordEnabled = ref(false)

  const effectiveSource = computed<DialogSource>(
    () => currentDialogSource.value ?? config.value.source
  )
  const effectiveTranslationLanguage = computed<string>(
    () =>
      currentTranslationLanguage.value ?? config.value.translationTargetLanguage
  )
  const hasContent = computed(
    () => segments.value.length > 0 || sessionBreaks.value.length > 0
  )

  const turns = computed(() => buildDialogTurns(segments.value))
  const feedItems = computed<DialogFeedItem[]>(() =>
    buildDialogFeedItems(turns.value, sessionBreaks.value)
  )

  const selectedTurnIds = ref<string[]>([])
  const selectionAnchorId = ref<string | null>(null)

  const selectionIncludeMe = computed({
    get: () => config.value.selectionIncludeMe ?? true,
    set: (value: boolean) => {
      void updateConfig({ selectionIncludeMe: value })
    },
  })

  const selectionUseTranslation = computed({
    get: () => config.value.selectionUseTranslation ?? false,
    set: (value: boolean) => {
      void updateConfig({ selectionUseTranslation: value })
    },
  })

  const hasSelection = computed(() => selectedTurnIds.value.length > 0)

  const selectedTurns = computed<DialogTurn[]>(() => {
    if (selectedTurnIds.value.length === 0) return []
    const selectedSet = new Set(selectedTurnIds.value)
    return turns.value.filter((turn) => selectedSet.has(turn.id))
  })

  const activeSelectedTurns = computed<DialogTurn[]>(() => {
    if (!selectionIncludeMe.value) {
      return selectedTurns.value.filter((turn) => turn.side !== 'me')
    }
    return selectedTurns.value
  })

  const selectedCount = computed(() => selectedTurnIds.value.length)
  const activeSelectedCount = computed(() => activeSelectedTurns.value.length)

  function toggleTurnSelection(turnId: string, isShift: boolean) {
    if (!isShift && selectedTurnIds.value.length === 0) return
    const result = toggleShiftTurnSelection(
      selectedTurnIds.value,
      turnId,
      turns.value,
      selectionAnchorId.value
    )
    selectedTurnIds.value = result.selectedIds
    selectionAnchorId.value = result.anchorId
  }

  function toggleSingleTurn(turnId: string) {
    const result = toggleSingleTurnSelection(
      selectedTurnIds.value,
      turnId,
      selectionAnchorId.value
    )
    selectedTurnIds.value = result.selectedIds
    selectionAnchorId.value = result.anchorId
  }

  function selectRangeUpToTurn(turnId: string) {
    const result = selectRangeUpTo(
      selectedTurnIds.value,
      turnId,
      turns.value,
      selectionAnchorId.value
    )
    selectedTurnIds.value = result.selectedIds
    selectionAnchorId.value = result.anchorId
  }

  async function copyTurnText(turnId: string) {
    const turn = turns.value.find((t) => t.id === turnId)
    if (!turn) return
    const text = turnText(turn)
    if (!text) return
    await useIpcStore().callOrNotify('copy_text', { text })
    useToastStore().toastKey('common.copied', 'success')
  }

  async function copyTurnTranslation(turnId: string) {
    const turn = turns.value.find((t) => t.id === turnId)
    if (!turn) return
    const text = turnTranslation(turn)
    if (!text) return
    await useIpcStore().callOrNotify('copy_text', { text })
    useToastStore().toastKey('common.copied', 'success')
  }

  function clearSelection() {
    selectedTurnIds.value = []
    selectionAnchorId.value = null
  }

  function setSelectedTurnIds(ids: string[]) {
    selectedTurnIds.value = ids
    if (ids.length === 0) {
      selectionAnchorId.value = null
    } else if (
      !selectionAnchorId.value ||
      !ids.includes(selectionAnchorId.value)
    ) {
      selectionAnchorId.value = ids[0]
    }
  }
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
    onUpdate: (id, patch) => {
      transcript.update(id, patch)
      // when retrying a translation on an idle/loaded dialog, persist it
      if (!isActive.value && patch.translationState === 'complete') {
        void dialogHistory.checkpoint()
      }
    },
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

  async function refreshRecordingExists() {
    const dialogId = currentDialogId.value
    const files = sessionBreaks.value
      .map((item) => item.recordingFile)
      .filter((file): file is string => Boolean(file))
    if (!dialogId || files.length === 0) {
      recordingExists.value = {}
      return
    }
    const result = await useIpcStore().call('check_dialog_recordings', {
      dialogId,
      files,
    })
    if (!result.success || !result.result) return
    if (currentDialogId.value !== dialogId) return
    const next: Record<string, boolean> = {}
    files.forEach((file, index) => {
      next[file] = result.result?.[index] ?? false
    })
    recordingExists.value = next
  }

  const session = createDialogSession({
    capture: {
      start: async (source, isMicrophoneMuted) => {
        const dialogId = currentDialogId.value ?? undefined
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
              if (
                recordingFile &&
                !incompleteRecordingFiles.value.includes(recordingFile)
              ) {
                incompleteRecordingFiles.value = [
                  ...incompleteRecordingFiles.value,
                  recordingFile,
                ]
              }
              if (isRecordingLinked && recordingFile)
                void dialogHistory.markRecordingIncomplete(recordingFile)
              else isRecordingFailedEarly = true
            },
          },
          desktopStore.userConfig.stt.microphoneId,
          isRecordingRequested,
          dialogId,
          isMicrophoneMuted
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
        const dialogId =
          currentDialogId.value ?? createDialogId(sessionStartedAtMs)
        currentDialogId.value = dialogId
        currentDialogSource.value = hasMicrophone.value
          ? 'microphoneAndSystem'
          : 'system'
        currentTranslationLanguage.value =
          config.value.translationTargetLanguage

        if (recordingFile && !isRecordingFailedEarly) {
          recording.value = {
            file: recordingFile,
            startedAtMs: sessionStartedAtMs,
          }
          isRecordEnabled.value = true
          recordingExists.value = {
            ...recordingExists.value,
            [recordingFile]: true,
          }
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
        } else {
          const hadRecordingBefore = sessionBreaks.value.some(
            (b) => b.isRecording
          )
          const action =
            isRecorded && !hadRecordingBefore ? 'started' : 'resumed'
          sessionBreaks.value.push({
            id: `break-${Date.now()}`,
            timestampMs: sessionStartedAtMs,
            isRecording: isRecorded,
            recordingFile: isRecorded ? recordingFile : undefined,
            action,
          })
        }
        if (!isFirstRun && dialogHistory.resume()) {
          if (recordingFile) {
            void dialogHistory.addRecording(recordingFile, {
              isIncomplete: isRecordingFailedEarly,
            })
          }
        } else {
          void dialogHistory.begin({
            id: dialogId,
            startedAt: sessionStartedAtMs,
            source: hasMicrophone.value ? 'microphoneAndSystem' : 'system',
            ...(recordingFile && { recordingFiles: [recordingFile] }),
            ...(recordingFile &&
              isRecordingFailedEarly && {
                incompleteRecordingFiles: [recordingFile],
              }),
          })
        }
      }
      status.value = next
      if (next !== 'running') {
        levels.me = 0
        levels.remote = 0
        recording.value = undefined
      }
      if (next === 'idle' || next === 'failed') {
        void dialogHistory.checkpoint().then(() => refreshRecordingExists())
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
        Math.max(sessionStartedAtMs, sessionStartedAtMs + Math.max(0, offsetMs))
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
        levels.me = hasMicrophone.value ? payload.channels[0] : 0
        levels.remote = payload.channels[1]
      } else {
        levels.remote = payload.level
      }
    })
    .catch(() => undefined)

  let isPreparing = false

  /**
   * Toggles the user's microphone on or off. If the dialog is running, it
   * mutes/unmutes on the fly: when muted, STT disconnects to avoid consuming
   * tokens and recording writes silence on channel 0.
   */
  async function toggleMicrophone() {
    const nextActive = !hasMicrophone.value
    hasMicrophone.value = nextActive
    void updateConfig({ source: nextActive ? 'microphoneAndSystem' : 'system' })
    if (status.value === 'running') {
      session.setMicrophoneMuted(!nextActive)
      await useIpcStore().call('set_capture_microphone_muted', {
        isMuted: !nextActive,
      })
      if (!nextActive) {
        levels.me = 0
      }
    }
  }

  /**
   * A session stopped while it started never got a saved dialog: its recording
   * is removed immediately.
   */
  function discardUnlinkedRecording() {
    const file = recordingFile
    const dialogId = currentDialogId.value
    if (!file || !dialogId || isRecordingLinked) return
    recordingFile = undefined
    void useIpcStore()
      .call('discard_dialog_recording', { dialogId, file })
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
    if (!currentDialogId.value) {
      currentDialogId.value = createDialogId(Date.now())
    }
    try {
      activeStt = await resolveDialogStt({
        getConfig: () => desktopStore.userConfig.stt,
        getRemoteLanguage: () => config.value.remoteLanguage,
        getOwnLanguage: () => config.value.ownLanguage,
        refreshSecrets: () => secretsStore.refreshSecrets(),
        getSecrets: () => secretsStore.secrets,
        translate,
      })
      const source = currentDialogSource.value ?? config.value.source
      hasMicrophone.value = source === 'microphoneAndSystem'
      let startError: unknown
      try {
        await session.start({
          isMicrophoneEnabled: true,
          isMicrophoneMuted: !hasMicrophone.value,
        })
      } catch (error) {
        startError = error
      }
      if (startError) {
        if (!hasMicrophone.value) {
          await session.start({
            isMicrophoneEnabled: false,
            isMicrophoneMuted: true,
          })
        } else {
          throw startError
        }
      }
    } catch (error) {
      if (!hasContent.value) currentDialogId.value = null
      showError(asDictationError('microphone', error))
    } finally {
      isPreparing = false
    }
  }

  function resetLocalState() {
    clearSelection()
    translationQueue.clear()
    transcript.clear()
    sessionBreaks.value = []
    currentDialogId.value = null
    currentDialogTitle.value = ''
    currentDialogSource.value = null
    currentTranslationLanguage.value = null
    incompleteRecordingFiles.value = []
    recordingExists.value = {}
    errorText.value = ''
    canFixInSettings.value = false
    isRecordEnabled.value = false
  }

  /** Saves any active session, clears the feed, and starts a clean slate. */
  async function clear() {
    if (isActive.value) return
    await dialogHistory.end()
    dialogHistory.reset()
    resetLocalState()
  }

  /** Loads a saved dialog from history into the dialog view. */
  async function openDialog(id: string): Promise<boolean> {
    if (isActive.value || isPreparing) return false
    await dialogHistory.end()
    const loaded: Dialog | null = await dialogHistoryStore.getDialog(id)
    if (!loaded) return false
    clearSelection()
    translationQueue.clear()
    currentDialogId.value = loaded.id
    currentDialogTitle.value = loaded.title
    currentDialogSource.value = loaded.source
    currentTranslationLanguage.value = loaded.translationTargetLanguage
    hasMicrophone.value = loaded.source === 'microphoneAndSystem'
    incompleteRecordingFiles.value = [
      ...(loaded.incompleteRecordingFiles ?? []),
    ]
    transcript.load(
      loaded.segments.map((segment) => ({ ...segment, isFinal: true }))
    )
    sessionBreaks.value = (loaded.sessionBreaks ?? []).map((item) => ({
      ...item,
    }))
    errorText.value = ''
    canFixInSettings.value = false
    isRecordEnabled.value = false
    dialogHistory.load(loaded)
    await refreshRecordingExists()
    return true
  }

  async function stop() {
    await session.stop()
  }

  /** Stops a running dialog and resolves once its transcript is saved */
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
      includeTranslation: Boolean(effectiveTranslationLanguage.value),
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

  function formatSelectedText(): string {
    return formatSelectedTurns(selectedTurns.value, {
      includeMe: selectionIncludeMe.value,
      useTranslation: selectionUseTranslation.value,
      labels: {
        me: translate('dialog.sideMe'),
        remote: translate('dialog.sideRemote'),
      },
    })
  }

  async function copySelected() {
    const text = formatSelectedText()
    if (!text) return
    await useIpcStore().callOrNotify('copy_text', { text })
    useToastStore().toastKey('common.copied', 'success')
  }

  async function sendSelectedToChat() {
    const text = formatSelectedText()
    if (!text) return
    const chatInputStore = useChatInputStore()
    chatInputStore.setValue(text + '\n\n')
    chatInputStore.requestFocus()
    await appNavigation.goToChat()
  }

  async function sendSelectedToActionMenu() {
    const text = formatSelectedText()
    if (!text) return
    return useIpcStore().callOrNotify('activate_mode', {
      mode: 'selectionActions',
      text,
      actionPageIndex: 0,
      actionOrigin: 'dialog',
    })
  }

  async function promptAiSelected() {
    return sendSelectedToActionMenu()
  }

  /** The transcript goes to the action menu as if it were selected text */
  async function sendToActionMenu(customText?: string) {
    const text = customText ?? exportText()
    if (!text) return
    return useIpcStore().callOrNotify('activate_mode', {
      mode: 'selectionActions',
      text,
      actionPageIndex: 0,
      actionOrigin: 'dialog',
    })
  }

  async function openRecordingsFolder(dialogId?: string) {
    return useIpcStore().callOrNotify('open_recordings_folder', {
      dialogId: dialogId ?? null,
    })
  }

  async function showRecording(dialogId: string, file: string) {
    return useIpcStore().callOrNotify('show_dialog_recording', {
      dialogId,
      file,
    })
  }

  const dialogHistory = createDialogHistory({
    isEnabled: () => isHistoryEnabled.value,
    save: dialogHistoryStore.saveDialog,
    getSnapshot: () => ({
      title: currentDialogTitle.value,
      translationTargetLanguage: effectiveTranslationLanguage.value,
      segments: segments.value,
      sessionBreaks: sessionBreaks.value,
    }),
    reportError: (error) =>
      clientLogger.warn(
        `Could not save the dialog to history: ${String(error)}`,
        'dialog'
      ),
    onRecordingUnlinked: () => {
      errorText.value = translate('dialog.recordingNotInHistory')
      canFixInSettings.value = false
    },
  })

  // turning dialog history off disables recording and warns if one is running
  watch(isHistoryEnabled, (isOnDisk) => {
    if (!isOnDisk) isRecordEnabled.value = false
    if (isOnDisk || !recording.value) return
    errorText.value = translate('dialog.recordingNotInHistory')
    canFixInSettings.value = false
  })

  // if the currently viewed idle dialog is deleted or cleared, reset the view
  let unlistenDialogsChanged: (() => void) | undefined
  let isDisposed = false
  void desktopClient
    .listen(DESKTOP_EVENTS.DIALOGS_CHANGED, (event) => {
      if (isActive.value || !currentDialogId.value) return
      if (
        event.isCleared ||
        event.removedDialogIds.includes(currentDialogId.value)
      ) {
        dialogHistory.reset()
        resetLocalState()
      }
    })
    .then((unlisten) => {
      if (isDisposed) unlisten()
      else unlistenDialogsChanged = unlisten
    })
    .catch(() => undefined)

  // keep currentDialogTitle synced when renamed in the history list
  watch(
    () =>
      currentDialogId.value
        ? dialogHistoryStore.dialogs.find((d) => d.id === currentDialogId.value)
            ?.title
        : undefined,
    (title) => {
      if (title !== undefined) currentDialogTitle.value = title
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
    isDisposed = true
    unlistenDialogsChanged?.()
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
      translationLanguage: effectiveTranslationLanguage.value,
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
    isHistoryEnabled,
    config,
    translationModel,
    status,
    channelStatus,
    levels,
    segments,
    sessionBreaks,
    turns,
    feedItems,
    hasContent,
    currentDialogId,
    currentDialogTitle,
    effectiveSource,
    effectiveTranslationLanguage,
    incompleteRecordingFiles,
    recordingExists,
    isHistoryOpen,
    errorText,
    canFixInSettings,
    isActive,
    isSubtitlesShown,
    hasMicrophone,
    toggleMicrophone,
    recording,
    isRecordEnabled,
    start,
    clear,
    openDialog,
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
    openRecordingsFolder,
    showRecording,
    showSubtitles,
    hideSubtitles,
    selectedTurnIds,
    selectionAnchorId,
    selectionIncludeMe,
    selectionUseTranslation,
    hasSelection,
    selectedTurns,
    activeSelectedTurns,
    selectedCount,
    activeSelectedCount,
    toggleTurnSelection,
    toggleSingleTurn,
    selectRangeUpToTurn,
    copyTurnText,
    copyTurnTranslation,
    clearSelection,
    setSelectedTurnIds,
    formatSelectedText,
    copySelected,
    sendSelectedToChat,
    sendSelectedToActionMenu,
    promptAiSelected,
  }
})
