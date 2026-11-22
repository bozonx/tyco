<template>
  <div class="history-item" :data-history-id="item.id">
    <div
      v-if="item.meta || item.time || visibleActions.length"
      class="history-item-header"
    >
      <div v-if="item.meta" class="history-meta">
        <span class="history-meta-badge">
          <AppIcon :icon="item.meta.icon" size="sm" />
          <span>{{ item.meta.label }}</span>
        </span>
        <span
          v-if="item.meta.note"
          class="history-meta-note"
          :class="{ 'is-error': item.meta.noteTone === 'error' }"
          :title="item.meta.noteDetail"
        >
          <AppIcon
            :icon="
              item.meta.noteIcon ||
              (item.meta.noteTone === 'error'
                ? 'mdi:alert-circle-outline'
                : 'mdi:check')
            "
            size="xs"
          />
          {{ item.meta.note }}
        </span>
      </div>

      <div class="history-item-end">
        <div v-if="visibleActions.length" class="history-item-actions">
          <IconButton
            v-for="action in visibleActions"
            :key="action.id"
            size="xs"
            variant="ghost"
            tone="muted"
            @click="emit('action', action.id, item)"
            :label="action.title"
            :icon="action.icon"
          />
        </div>

        <span v-if="item.time" class="history-date">
          <time
            :datetime="new Date(item.time).toISOString()"
            :title="formatHistoryDateTime(item.time, locale)"
          >
            {{ formatHistoryTime(item.time, locale) }}
          </time>
        </span>
      </div>
    </div>

    <div class="history-content">
      <div
        :id="textId"
        v-if="item.value"
        class="history-text-value"
        :class="{ expanded: expanded }"
      >
        {{ item.value }}
      </div>
      <div v-else class="text-faint italic">
        {{ t('common.empty') }}
      </div>

      <div v-if="displayedFiles.length" class="history-files">
        <div v-if="item.filesSection" class="history-files-header">
          <span class="history-files-title">{{ item.filesSection.title }}</span>
          <Button
            v-if="item.filesSection.action"
            size="xs"
            variant="ghost"
            :icon="item.filesSection.action.icon"
            @click="emit('action', item.filesSection.action.id, item)"
            >{{ item.filesSection.action.title }}</Button
          >
        </div>
        <div
          v-for="f in displayedFiles"
          :key="f.name"
          class="history-file"
          :class="{ 'is-active': activePlayerFile === f.name }"
        >
          <AppIcon icon="mdi:file-music-outline" size="xs" />
          <span class="history-file-name" :title="f.name">{{ f.name }}</span>
          <span v-if="f.isMissing" class="history-file-missing">{{
            f.missingLabel
          }}</span>
          <template v-else>
            <span v-if="f.note" class="history-file-note">{{ f.note }}</span>
            <IconButton
              v-if="f.playback"
              size="xs"
              variant="ghost"
              :disabled="
                activePlayerFile !== f.name && Boolean(f.playback.disabledTitle)
              "
              :label="
                activePlayerFile === f.name
                  ? f.playback.stopTitle
                  : f.playback.disabledTitle || f.playback.playTitle
              "
              :icon="activePlayerFile === f.name ? 'mdi:stop' : 'mdi:play'"
              @click="togglePlayer(f)"
            />
            <template v-if="f.playback && activePlayerFile === f.name">
              <audio
                v-if="playerSource"
                ref="audioElement"
                class="history-player-audio"
                autoplay
                preload="auto"
                :src="playerSource"
                @error="onAudioError($event, f.name)"
                @loadedmetadata="onLoadedMetadata($event, f.name)"
                @durationchange="onDurationChange($event, f.name)"
                @timeupdate="onTimeUpdate($event, f.name)"
                @pause="onAudioPause($event, f.name)"
                @ended="onAudioEnded(f.name)"
              />
              <span v-if="isPlayerFailed" class="history-file-missing">{{
                f.playback.unavailableLabel
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
                  :aria-label="f.name"
                  @input="onSeekInput"
                />
                <span class="history-player-time">
                  {{ formatPlaybackTime(playerCurrentTime) }} /
                  {{ formatPlaybackTime(playerDuration) }}
                </span>
                <FieldSelect
                  :model-value="playbackRate"
                  size="xs"
                  class="history-player-speed"
                  :options="SPEED_OPTIONS"
                  :title="f.playback.speedTitle"
                  :aria-label="f.playback.speedTitle"
                  @update:model-value="setPlaybackRate"
                />
              </div>
            </template>
          </template>
        </div>
      </div>

      <DisclosureHeader
        v-if="isLong"
        class="history-expand-toggle"
        density="compact"
        :expanded="expanded"
        :controls="textId"
        :title="expanded ? t('history.collapse') : t('history.expand')"
        @toggle="emit('toggleExpanded')"
      />

      <div v-if="hasDetails" class="history-original">
        <DisclosureHeader
          class="history-original-toggle"
          density="compact"
          :expanded="originalShown"
          :controls="originalId"
          :title="detailsTitle"
          @toggle="emit('toggleOriginal')"
        />
        <div v-if="originalShown" :id="originalId" class="history-details">
          <div v-if="item.original" class="history-original-body">
            <div class="history-original-text">
              {{ item.original.text }}
            </div>
            <div class="history-original-actions">
              <IconButton
                v-for="action in originalActions"
                :key="action.id"
                size="xs"
                variant="ghost"
                @click="emit('action', action.id, item)"
                :label="action.title"
                :icon="action.icon"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  formatHistoryDateTime,
  formatHistoryTime,
} from '../../lib/history/history-list'
import type {
  HistoryListAction,
  HistoryListItem,
  HistoryListItemFile,
} from '../../lib/history/history-list-types'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'

const props = defineProps<{
  expanded: boolean
  originalShown: boolean
  item: HistoryListItem
  actions: HistoryListAction[]
  originalActions: HistoryListAction[]
}>()
const emit = defineEmits<{
  action: [actionId: string, item: HistoryListItem]
  toggleExpanded: []
  toggleOriginal: []
}>()
const { t, locale } = useI18n()
const textId = useId()
const originalId = useId()
const LONG_ENTRY_CHAR_LIMIT = 200
const LONG_ENTRY_LINE_LIMIT = 3

const SPEED_OPTIONS = [
  { id: 1, name: '1×' },
  { id: 1.5, name: '1.5×' },
  { id: 2, name: '2×' },
]

const visibleActions = computed(() =>
  props.actions.filter((action) => action.isVisible?.(props.item) ?? true)
)
const displayedFiles = computed<HistoryListItemFile[]>(() => {
  if (props.item.files?.length) return props.item.files
  return props.item.file ? [props.item.file] : []
})
const activePlayerFile = ref<string>('')
/** The URL the open player plays; empty while it is closed */
const playerSource = ref('')
const isPlayerFailed = ref(false)
const audioElement = ref<HTMLAudioElement | HTMLAudioElement[] | null>(null)
const playerCurrentTime = ref(0)
const playerDuration = ref(0)
const playbackRate = ref<number>(1)
let disposePlayerSource: (() => void) | undefined
let loadSequence = 0

function currentAudio(): HTMLAudioElement | null {
  const el = audioElement.value
  if (Array.isArray(el)) return el[0] ?? null
  return el
}

function stopPlayer() {
  loadSequence++
  disposePlayerSource?.()
  disposePlayerSource = undefined
  activePlayerFile.value = ''
  playerSource.value = ''
  playerCurrentTime.value = 0
  playerDuration.value = 0
}

async function togglePlayer(f: HistoryListItemFile) {
  isPlayerFailed.value = false
  if (activePlayerFile.value === f.name) {
    stopPlayer()
    return
  }
  stopPlayer()
  if (!f.playback) return
  activePlayerFile.value = f.name
  const seq = ++loadSequence
  try {
    const resolved = await f.playback.source()
    if (seq !== loadSequence || activePlayerFile.value !== f.name) {
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
    if (seq === loadSequence && activePlayerFile.value === f.name) {
      isPlayerFailed.value = true
    }
  }
}

function onAudioError(_event: Event, fileName: string) {
  if (activePlayerFile.value === fileName && playerSource.value) {
    isPlayerFailed.value = true
  }
}

function onLoadedMetadata(event: Event, fileName: string) {
  if (activePlayerFile.value !== fileName) return
  isPlayerFailed.value = false
  const audio = event.target as HTMLAudioElement
  audio.playbackRate = playbackRate.value
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    playerDuration.value = audio.duration
  }
}

function onDurationChange(event: Event, fileName: string) {
  if (activePlayerFile.value !== fileName) return
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    playerDuration.value = audio.duration
  }
}

function onTimeUpdate(event: Event, fileName: string) {
  if (activePlayerFile.value !== fileName) return
  const audio = event.target as HTMLAudioElement
  if (Number.isFinite(audio.currentTime)) {
    playerCurrentTime.value = audio.currentTime
  }
}

function onAudioPause(event: Event, fileName: string) {
  if (activePlayerFile.value !== fileName) return
  const audio = event.target as HTMLAudioElement
  // `pauseOtherPlayers` in HistoryList pauses this element when another starts
  if (!audio.ended && !audio.seeking) {
    stopPlayer()
  }
}

function onAudioEnded(fileName: string) {
  if (activePlayerFile.value === fileName) {
    stopPlayer()
  }
}

function onSeekInput(event: Event) {
  const input = event.target as HTMLInputElement
  const nextTime = Number(input.value)
  if (!Number.isFinite(nextTime)) return
  playerCurrentTime.value = nextTime
  const audio = currentAudio()
  if (audio) audio.currentTime = nextTime
}

function setPlaybackRate(value: number | string | undefined) {
  const rate = Number(value)
  if (rate !== 1 && rate !== 1.5 && rate !== 2) return
  playbackRate.value = rate
  const audio = currentAudio()
  if (audio) audio.playbackRate = rate
}

function formatPlaybackTime(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

onUnmounted(() => {
  stopPlayer()
})

// the file went, or a dialog started recording: the player stops
watch(
  () => {
    const active = displayedFiles.value.find(
      (f) => f.name === activePlayerFile.value
    )
    return (
      !active?.playback ||
      Boolean(active.playback.disabledTitle) ||
      Boolean(active.isMissing)
    )
  },
  (isUnplayable) => {
    if (isUnplayable) {
      stopPlayer()
    }
  }
)
const hasDetails = computed(() => Boolean(props.item.original))
const detailsTitle = computed(() => props.item.original?.label ?? '')
const isLong = computed(
  () =>
    props.item.value.length > LONG_ENTRY_CHAR_LIMIT ||
    props.item.value.split('\n').length > LONG_ENTRY_LINE_LIMIT
)
</script>
<style scoped>
.history-item {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.history-item:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.history-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 1.5rem;
  margin-bottom: var(--space-2xs);
}

.history-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: none;
}

.history-files {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  margin-top: var(--space-xs);
}

.history-files-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.history-files-title {
  font-weight: 600;
}

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
  width: auto;
  min-width: 3.75rem;
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

.history-meta-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}

.history-meta-note {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--color-success);
}

.history-meta-note.is-error {
  color: var(--color-error);
}

.history-item-end {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}

.history-date {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-caption);
  color: var(--app-text-faint);
  user-select: none;
}

.history-content {
  flex: 1;
  min-width: 0;
  cursor: default;
}

.history-text-value {
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--color-base-content);
  white-space: pre-line;
  word-break: break-word;
  user-select: text;
  cursor: text;
}

.history-text-value:not(.expanded) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.history-text-value.expanded {
  display: block;
  white-space: pre-wrap;
}

.history-original {
  margin-top: var(--space-xs);
}

.history-original-body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin-top: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm);
  border-left: 2px solid var(--app-border);
  background-color: var(--app-surface-sunken);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.history-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.history-original-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-control);
  line-height: 1.5;
  color: var(--app-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
}

.history-original-actions {
  --button-ghost-color: var(--app-text-muted);
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.history-item-actions {
  --button-ghost-color: var(--app-text-muted);
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
}

.history-item:hover .history-item-actions,
.history-item:focus-within .history-item-actions {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .history-item-actions {
    opacity: 1;
    pointer-events: auto;
  }
}

.history-expand-toggle,
.history-original-toggle {
  width: fit-content;
  font-size: var(--text-caption);
}
.history-expand-toggle {
  margin-top: var(--space-xs);
  color: var(--color-primary);
}
</style>
