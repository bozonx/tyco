<template>
  <div class="dialog-recording-player" :class="{ 'is-playing': isPlaying }">
    <audio
      v-if="playerSource"
      ref="audioElement"
      class="dialog-player-audio"
      autoplay
      preload="auto"
      :src="playerSource"
      @error="onError"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onDurationChange"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
    />
    <div class="dialog-recording-bar">
      <AppIcon icon="mdi:file-music-outline" size="xs" class="shrink-0" />
      <span class="dialog-recording-name" :title="file">{{ file }}</span>
      <IconButton
        size="xs"
        variant="ghost"
        tone="muted"
        icon="mdi:folder-open-outline"
        :label="t('settings.storageOpenFolder')"
        @click="openFolder"
      />
      <IconButton
        size="xs"
        variant="ghost"
        :disabled="isPlayDisabled"
        :icon="isPlaying ? 'mdi:stop' : 'mdi:play'"
        :label="playButtonLabel"
        @click="togglePlay"
      />
    </div>
    <div v-if="isPlayerFailed" class="dialog-recording-error">
      {{ t('history.recordingUnplayable') }}
    </div>
    <div v-else-if="isPlaying" class="dialog-recording-expanded">
      <input
        type="range"
        class="dialog-player-seek"
        min="0"
        :max="playerDuration || 0"
        step="0.1"
        :value="playerCurrentTime"
        :disabled="!playerDuration"
        :aria-label="file"
        @input="onSeekInput"
      />
      <span class="dialog-player-time">
        {{ formatPlaybackTime(playerCurrentTime) }} /
        {{ formatPlaybackTime(playerDuration) }}
      </span>
      <SegmentedControl
        :model-value="playbackRate"
        size="xs"
        class="dialog-player-speed"
        :options="SPEED_OPTIONS"
        :label="t('history.playbackSpeed')"
        @update:model-value="onPlaybackRateChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSoundCaptureActivity } from '../../composables/use-sound-capture-activity'
import { convertFileSrc } from '../../lib/desktop/window'
import { loadRecordingMediaSource } from '../../lib/history/recording-media-url'
import type { ControlOption } from '../../lib/ui/control-option'
import { useDialogStore } from '../../stores/dialog'
import { useIpcStore } from '../../stores/ipc'
import AppIcon from '../common/AppIcon.vue'
import IconButton from '../common/IconButton.vue'
import SegmentedControl from '../common/SegmentedControl.vue'

const props = defineProps<{
  file: string
}>()

const SPEED_OPTIONS: ControlOption<number>[] = [
  { id: 0.75, name: '0.75×' },
  { id: 1, name: '1×' },
  { id: 1.25, name: '1.25×' },
  { id: 1.5, name: '1.5×' },
  { id: 2, name: '2×' },
]

const { t } = useI18n()
const dialog = useDialogStore()
const ipcStore = useIpcStore()
const isSoundCaptured = useSoundCaptureActivity()

const isPlaying = ref(false)
const playerSource = ref('')
const audioElement = ref<HTMLAudioElement | null>(null)
const playerDuration = ref(0)
const playerCurrentTime = ref(0)
const playbackRate = ref(1)
const isPlayerFailed = ref(false)
let disposeSource: (() => void) | undefined

const isPlayDisabled = computed(
  () => !isPlaying.value && (dialog.isActive || isSoundCaptured.value)
)

const playButtonLabel = computed(() => {
  if (isPlaying.value) return t('history.stopRecording')
  if (isPlayDisabled.value) return t('history.playRecordingWhileCapturing')
  return t('history.playRecording')
})

function stop() {
  if (audioElement.value) {
    audioElement.value.pause()
  }
  disposeSource?.()
  disposeSource = undefined
  playerSource.value = ''
  isPlaying.value = false
  playerCurrentTime.value = 0
}

async function togglePlay() {
  if (isPlaying.value) {
    stop()
    return
  }
  if (isPlayDisabled.value) return
  isPlayerFailed.value = false

  try {
    const readRecording = async (file: string): Promise<ArrayBuffer> => {
      const result = await ipcStore.call('read_dialog_recording', { file })
      if (!result.success || !result.result) {
        throw new Error(result.error ?? 'Could not read recording')
      }
      return result.result
    }

    const loaded = await loadRecordingMediaSource(
      props.file,
      convertFileSrc,
      readRecording
    )
    playerSource.value = loaded.url
    disposeSource = loaded.dispose
    isPlaying.value = true
  } catch {
    isPlayerFailed.value = true
    stop()
  }
}

function openFolder() {
  void ipcStore.call('show_dialog_recording', { file: props.file })
}

function onError() {
  isPlayerFailed.value = true
  stop()
}

function onLoadedMetadata(event: Event) {
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.duration)) {
    playerDuration.value = audio.duration
  }
}

function onDurationChange(event: Event) {
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.duration)) {
    playerDuration.value = audio.duration
  }
}

function onTimeUpdate(event: Event) {
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.currentTime)) {
    playerCurrentTime.value = audio.currentTime
  }
}

function onEnded() {
  stop()
}

function onSeekInput(event: Event) {
  const input = event.target as HTMLInputElement
  const nextTime = Number(input.value)
  if (!Number.isFinite(nextTime)) return
  playerCurrentTime.value = nextTime
  if (audioElement.value) {
    audioElement.value.currentTime = nextTime
  }
}

function onPlaybackRateChange(value: number) {
  const rate = Number(value)
  if (!SPEED_OPTIONS.some((opt) => opt.id === rate)) return
  playbackRate.value = rate
  if (audioElement.value) {
    audioElement.value.playbackRate = rate
  }
}

function formatPlaybackTime(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

watch(
  () => dialog.isActive || isSoundCaptured.value,
  (busy) => {
    if (busy && isPlaying.value) {
      stop()
    }
  }
)

onBeforeUnmount(() => {
  stop()
})
</script>

<style scoped>
.dialog-recording-player {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-xs);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-sm);
  max-width: 100%;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: text;
}

.dialog-recording-bar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.dialog-recording-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.dialog-player-audio {
  display: none;
}

.dialog-recording-expanded {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
  padding-top: var(--space-2xs);
  border-top: 1px solid var(--app-border-subtle);
}

.dialog-player-seek {
  flex: 1 1 6rem;
  min-width: 4rem;
  max-width: 12rem;
  height: 0.25rem;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.dialog-player-seek:disabled {
  cursor: default;
  opacity: 0.5;
}

.dialog-player-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  color: var(--app-text-faint);
}

.dialog-player-speed {
  flex-shrink: 0;
}

.dialog-recording-error {
  font-size: 0.75rem;
  color: var(--color-error);
}
</style>
