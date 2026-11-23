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

      <DisclosureHeader
        v-if="isLong"
        class="history-expand-toggle"
        density="compact"
        :expanded="expanded"
        :controls="textId"
        :title="expanded ? t('history.collapse') : t('history.expand')"
        @toggle="emit('toggleExpanded')"
      />

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
        <HistoryFilePlayer
          v-for="f in displayedFiles"
          :key="f.name"
          :file="f"
          :is-active="activePlayerFile === f.name"
          @toggle="togglePlayer(f)"
          @stop="stopPlayer"
        />
      </div>

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
import IconButton from '../common/IconButton.vue'
import HistoryFilePlayer from './HistoryFilePlayer.vue'

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

const visibleActions = computed(() =>
  props.actions.filter((action) => action.isVisible?.(props.item) ?? true)
)
const displayedFiles = computed<HistoryListItemFile[]>(() => {
  if (props.item.files?.length) return props.item.files
  return props.item.file ? [props.item.file] : []
})
const activePlayerFile = ref<string>('')

function stopPlayer() {
  activePlayerFile.value = ''
}

function togglePlayer(f: HistoryListItemFile) {
  if (activePlayerFile.value === f.name) {
    stopPlayer()
    return
  }
  if (!f.playback || Boolean(f.playback.disabledTitle)) return
  activePlayerFile.value = f.name
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
