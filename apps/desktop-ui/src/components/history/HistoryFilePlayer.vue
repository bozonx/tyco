<template>
  <div class="history-file" :class="{ 'is-active': active }">
    <AppIcon icon="mdi:file-music-outline" size="xs" />
    <span class="history-file-name" :title="file.name">{{ file.name }}</span>
    <span v-if="file.isMissing" class="history-file-missing">{{
      file.missingLabel
    }}</span>
    <template v-else>
      <span v-if="file.note" class="history-file-note">{{ file.note }}</span>
      <IconButton
        v-if="file.playback"
        size="xs"
        variant="ghost"
        :disabled="!active && Boolean(file.playback.disabledTitle)"
        :label="
          active
            ? file.playback.stopTitle
            : file.playback.disabledTitle || file.playback.playTitle
        "
        :icon="active ? 'mdi:stop' : 'mdi:play'"
        @click="toggle"
      />
      <template v-if="file.playback && active">
        <audio
          v-if="playerSource"
          ref="audioElement"
          class="history-player-audio"
          autoplay
          preload="auto"
          :src="playerSource"
          @error="onAudioError"
          @loadedmetadata="onLoadedMetadata"
          @durationchange="onDurationChange"
          @timeupdate="onTimeUpdate"
          @pause="onAudioPause"
          @ended="onAudioEnded"
        />
        <span v-if="isPlayerFailed" class="history-file-missing">{{
          file.playback.unavailableLabel
        }}</span>
        <div v-else-if="playerSource" class="history-inline-player">
          <input
            type="range"
            class="history-player-seek"
            min="0"
            :max="playerDuration || 0"
            step="0.1"
            :value="playerCurrentTime"
            :disabled="!playerDuration"
            :aria-label="file.name"
            @input="onSeekInput"
          />
          <span class="history-player-time">
            {{ formatPlaybackTime(playerCurrentTime) }} /
            {{ formatPlaybackTime(playerDuration) }}
          </span>
          <SegmentedControl
            :model-value="playbackRate"
            size="xs"
            class="history-player-speed"
            :options="SPEED_OPTIONS"
            :label="file.playback.speedTitle"
            @update:model-value="onPlaybackRateChange"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useAudioPlaybackRate } from '../../composables/use-audio-playback-rate'
import { SPEED_OPTIONS } from '../../lib/history/audio-playback-rate'
import type { HistoryListItemFile } from '../../lib/history/history-list-types'
import AppIcon from '../common/AppIcon.vue'
import IconButton from '../common/IconButton.vue'
import SegmentedControl from '../common/SegmentedControl.vue'

const props = withDefaults(
  defineProps<{ file: HistoryListItemFile; isActive?: boolean }>(),
  { isActive: undefined }
)

const emit = defineEmits<{ (e: 'toggle'): void; (e: 'stop'): void }>()

const isSelfActive = ref(false)
const active = computed(() =>
  props.isActive !== undefined ? props.isActive : isSelfActive.value
)

const playerSource = ref('')
const isPlayerFailed = ref(false)
const audioElement = ref<HTMLAudioElement | null>(null)
const playerCurrentTime = ref(0)
const playerDuration = ref(0)
const { playbackRate, setPlaybackRate } = useAudioPlaybackRate()
let disposePlayerSource: (() => void) | undefined
let loadSequence = 0

function stop() {
  loadSequence += 1
  disposePlayerSource?.()
  disposePlayerSource = undefined
  playerSource.value = ''
  playerCurrentTime.value = 0
  playerDuration.value = 0
  if (props.isActive === undefined) {
    isSelfActive.value = false
  } else {
    emit('stop')
  }
}

function toggle() {
  if (props.isActive !== undefined) {
    emit('toggle')
  } else {
    if (isSelfActive.value) {
      stop()
    } else {
      if (props.file.playback?.disabledTitle) return
      isSelfActive.value = true
    }
  }
}

async function startPlayback() {
  isPlayerFailed.value = false
  const playback = props.file.playback
  if (!playback) {
    stop()
    return
  }
  const seq = ++loadSequence
  try {
    const resolved = await playback.source()
    if (seq !== loadSequence || !active.value) {
      if (typeof resolved === 'object') resolved.dispose?.()
      return
    }
    if (typeof resolved === 'string') {
      playerSource.value = resolved
    } else {
      playerSource.value = resolved.url
      disposePlayerSource = resolved.dispose
    }
  } catch {
    if (seq === loadSequence && active.value) {
      isPlayerFailed.value = true
    }
  }
}

watch(
  () => active.value,
  (isActive) => {
    if (isActive) {
      void startPlayback()
    } else {
      loadSequence += 1
      disposePlayerSource?.()
      disposePlayerSource = undefined
      playerSource.value = ''
      playerCurrentTime.value = 0
      playerDuration.value = 0
    }
  },
  { immediate: true }
)

watch(
  () => props.file.playback?.disabledTitle,
  (disabled) => {
    if (disabled && active.value) {
      stop()
    }
  }
)

function onAudioError() {
  if (active.value && playerSource.value) {
    isPlayerFailed.value = true
  }
}

function onLoadedMetadata(event: Event) {
  if (!active.value) return
  isPlayerFailed.value = false
  const audio = event.target as HTMLAudioElement
  audio.playbackRate = playbackRate.value
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    playerDuration.value = audio.duration
  }
}

function onDurationChange(event: Event) {
  if (!active.value) return
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    playerDuration.value = audio.duration
  }
}

function onTimeUpdate(event: Event) {
  if (!active.value) return
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.currentTime)) {
    playerCurrentTime.value = audio.currentTime
  }
}

function onAudioPause(event: Event) {
  if (!active.value) return
  const audio = event.target as HTMLAudioElement
  if (!audio.ended && !audio.seeking) {
    stop()
  }
}

function onAudioEnded() {
  if (active.value) {
    stop()
  }
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
  setPlaybackRate(rate)
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

onBeforeUnmount(() => {
  loadSequence += 1
  disposePlayerSource?.()
  disposePlayerSource = undefined
})
</script>

<style scoped>
.history-file {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-width: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.history-player-audio {
  display: none;
}

.history-inline-player {
  display: inline-flex;
  align-items: center;
  flex: 1 1 12rem;
  gap: var(--space-xs);
  min-width: 10rem;
}

.history-player-seek {
  flex: 1 1 6rem;
  min-width: 4rem;
  max-width: 14rem;
  height: 0.25rem;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.history-player-seek:disabled {
  cursor: default;
  opacity: 0.5;
}

.history-player-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--app-text-faint);
}

.history-player-speed {
  flex-shrink: 0;
}

.history-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-file-missing {
  flex-shrink: 0;
  color: var(--color-error);
}

.history-file-note {
  flex-shrink: 0;
  color: var(--color-warning);
}
</style>
