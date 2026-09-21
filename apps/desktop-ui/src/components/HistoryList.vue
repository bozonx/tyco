<template>
  <div class="history-list">
    <div v-if="filtered.length === 0" class="history-empty">
      <div class="history-empty-icon">
        <Icon
          :icon="searchQuery ? 'mdi:text-search' : 'mdi:history'"
          height="28"
        />
      </div>
      <div class="font-medium">
        {{ searchQuery ? t('history.nothingFound') : t('history.empty') }}
      </div>
      <div v-if="!searchQuery" class="text-sm text-muted">
        {{ t('history.emptyHint') }}
      </div>
    </div>

    <template v-else>
      <div class="history-toolbar">
        <span class="text-xs text-muted">
          {{ filtered.length }} / {{ items.length }}
        </span>
        <Button
          xs
          ghost
          icon="mdi:trash-can-outline"
          class="clear-btn"
          @click="emit('clear-history')"
        >
          {{ t('history.clear') }}
        </Button>
      </div>

      <ul class="history-items">
        <li v-for="item in filtered" :key="item.id" class="history-item">
          <button
            type="button"
            class="history-text"
            :title="textTitle"
            @click="emit('text-click', item)"
          >
            <span v-if="item.meta || item.date" class="history-meta">
              <template v-if="item.meta">
                <Icon :icon="item.meta.icon" height="14" />
                <span>{{ item.meta.label }}</span>
              </template>
              <span v-if="item.date" class="history-date">{{ item.date }}</span>
            </span>
            <span v-if="item.value" class="history-text-value">{{
              truncate(item.value, 400)
            }}</span>
            <span v-else class="text-faint italic">{{
              t('common.empty')
            }}</span>
          </button>

          <div class="history-item-actions">
            <Button
              xs
              ghost
              square
              :title="textTitle"
              @click="emit('text-click', item)"
            >
              <Icon :icon="openIcon" height="16" />
            </Button>
            <Button
              xs
              ghost
              square
              @click="emit('remove-item', item)"
              :title="t('history.removeItem')"
              class="remove-history-btn"
            >
              <Icon icon="mdi:trash-can-outline" height="16" />
            </Button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../composables/useI18n'
import { truncate } from '@/lib/squidlet-lib-local'
import { Icon } from '@iconify/vue'

const { t } = useI18n()

export interface HistoryListItem {
  id: string | number
  value: string
  /** Why the entry is in the history, shown above the text. */
  meta?: { icon: string; label: string }
  date?: string
}

const emit = defineEmits<{
  (e: 'remove-item', item: HistoryListItem): void
  (e: 'clear-history'): void
  (e: 'text-click', item: HistoryListItem): void
}>()

const props = withDefaults(
  defineProps<{
    items: HistoryListItem[]
    searchQuery?: string
    textTitle?: string
    openIcon?: string
  }>(),
  { searchQuery: '', textTitle: '', openIcon: 'mdi:arrow-top-right' }
)

const filtered = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase()

  if (!query) return props.items

  return props.items.filter((item) =>
    (item.value || '').toLowerCase().includes(query)
  )
})
</script>

<style scoped>
.history-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.history-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 0 var(--space-xs) var(--space-sm);
}

.clear-btn {
  color: var(--app-text-muted);
}

.clear-btn:hover {
  color: var(--color-error);
}

.history-items {
  flex: 0 1 auto;
  min-height: 0;
  margin: 0 0 var(--space-xl);
  padding: 0;
  list-style: none;
  overflow-y: auto;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
}

.history-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) 0;
  transition: background-color var(--transition-fast);
}

.history-item + .history-item {
  border-top: 1px solid var(--app-border-subtle);
}

.history-item:hover {
  background-color: var(--app-hover);
}

.history-text {
  flex: 1;
  min-width: 0;
  padding: 0.5rem var(--space-lg);
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.history-text:focus-visible {
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: 0.125rem;
  font-size: 0.75rem;
  color: var(--app-text-muted);
}

.history-date {
  margin-left: auto;
  color: var(--app-text-faint);
}

.history-text-value {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: pre-line;
  word-break: break-word;
}

.history-item-actions {
  display: flex;
  gap: 2px;
  padding-top: 0.375rem;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.history-item:hover .history-item-actions,
.history-item:focus-within .history-item-actions {
  opacity: 1;
}

.history-item-actions :deep(.btn) {
  color: var(--app-text-muted);
}

.remove-history-btn:hover {
  color: var(--color-error) !important;
}

.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-3xl) var(--space-lg);
  margin-top: var(--space-lg);
  text-align: center;
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-lg);
}

.history-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  margin-bottom: var(--space-sm);
  border-radius: 999px;
  background-color: var(--app-hover);
  color: var(--app-text-muted);
}
</style>
