import { DESKTOP_EVENTS, type DialogConfig } from '@tyco/shared'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

import { exportDialogTranscript } from '../lib/dialog/dialog-export'
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
import { useIpcStore } from './ipc'
import { useSecretsStore } from './secrets'
import { useTranslationStore } from './translation'

const DEFAULT_DIALOG_CONFIG: DialogConfig = {
  source: 'microphoneAndSystem',
  translationTargetLanguage: '',
  textDisplay: 'both',
  translationProvider: 'default',
}

/**
 * The dialog: a long transcription of a call that runs in the background until
 * it is stopped, whatever tab the main window shows.
 */
export const useDialogStore = defineStore('dialog', () => {
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
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
  const isCompact = ref(false)
  /** Whether the running dialog records the microphone too */
  const hasMicrophone = ref(config.value.source === 'microphoneAndSystem')

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
      start: (source) =>
        capture.start(source, {}, desktopStore.userConfig.stt.microphoneId),
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
      if (next === 'running') sessionStartedAtMs = Date.now()
      status.value = next
      if (next !== 'running') {
        levels.me = 0
        levels.remote = 0
      }
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

  async function start() {
    if (isActive.value || isPreparing) return
    isPreparing = true
    errorText.value = ''
    canFixInSettings.value = false
    for (const side of ['me', 'remote'] as const) delete channelStatus[side]
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
    await Promise.all([session.stop(), leaveCompact()])
  }

  function retryTranslation(id: string) {
    const segment = segments.value.find((item) => item.id === id)
    if (segment?.translationState === 'failed') translationQueue.retry(segment)
  }

  function clear() {
    translationQueue.clear()
    transcript.clear()
    errorText.value = ''
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

  async function enterCompact() {
    const result = await useIpcStore().callOrNotify('enter_compact_window', {
      geometry: config.value.compactGeometry ?? null,
    })
    if (result.success) isCompact.value = true
  }

  async function leaveCompact() {
    const result = await useIpcStore().callOrNotify('leave_compact_window')
    isCompact.value = false
    if (result.success && result.result)
      await updateConfig({ compactGeometry: result.result })
  }

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
    isCompact,
    hasMicrophone,
    start,
    stop,
    stopAndExpand,
    retryTranslation,
    clear,
    exportText,
    updateConfig,
    copyTranscript,
    sendToActionMenu,
    enterCompact,
    leaveCompact,
  }
})
