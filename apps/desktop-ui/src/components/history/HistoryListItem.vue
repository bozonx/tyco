<template>
  <div class="history-item" :data-history-id="item.id">
    <div
      v-if="item.meta || item.time || visibleActions.length"
      class="history-item-header"
    >
      <div v-if="item.meta || item.time" class="history-meta">
        <template v-if="item.meta">
          <span class="history-meta-badge">
            <AppIcon :icon="item.meta.icon" size="sm" />
            <span>{{ item.meta.label }}</span>
          </span>
          <span v-if="item.meta.note" class="history-meta-note">
            <AppIcon icon="mdi:check" size="xs" />
            {{ item.meta.note }}
          </span>
        </template>
        <span v-if="item.time" class="history-date">
          <span v-if="item.meta" class="history-meta-divider" aria-hidden="true"
            >•</span
          >
          <time
            :datetime="new Date(item.time).toISOString()"
            :title="formatHistoryDateTime(item.time, locale)"
          >
            {{ formatHistoryTime(item.time, locale) }}
          </time>
        </span>
      </div>

      <div v-if="visibleActions.length" class="history-item-actions">
        <IconButton
          v-for="action in visibleActions"
          :key="action.id"
          size="xs"
          :variant="action.danger ? 'danger-ghost' : 'ghost'"
          tone="muted"
          @click="emit('action', action.id, item)"
          :label="action.title"
          :icon="action.icon"
        />
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

      <div v-if="item.original" class="history-original">
        <DisclosureHeader
          class="history-original-toggle"
          density="compact"
          :expanded="originalShown"
          :controls="originalId"
          :title="item.original.label"
          @toggle="emit('toggleOriginal')"
        />
        <div
          v-if="originalShown"
          :id="originalId"
          class="history-original-body"
        >
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
</template>
<script setup lang="ts">
import { computed, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  formatHistoryDateTime,
  formatHistoryTime,
} from '../../lib/history/history-list'
import type {
  HistoryListAction,
  HistoryListItem,
} from '../../lib/history/history-list-types'
import AppIcon from '../common/AppIcon.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
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
const visibleActions = computed(() =>
  props.actions.filter((action) => action.isVisible?.(props.item) ?? true)
)
const isLong = computed(
  () => props.item.value.length > 200 || props.item.value.split('\n').length > 3
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

.history-meta-divider {
  color: var(--app-text-faint);
  opacity: 0.6;
}

.history-date {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--app-text-faint);
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
  margin-left: auto;
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
