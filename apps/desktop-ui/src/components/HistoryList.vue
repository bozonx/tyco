<template>
  <div class="history-list">
    <slot name="notice" />

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
      <div v-if="!searchQuery && emptyHint" class="text-sm text-muted">
        {{ emptyHint }}
      </div>
    </div>

    <template v-else>
      <div class="history-toolbar">
        <template v-if="confirmingClear">
          <span class="text-sm">
            {{ t('history.clearConfirm', { count: totalCount }) }}
          </span>
          <span class="history-toolbar-buttons">
            <Button xs ghost @click="confirmingClear = false">
              {{ t('common.cancel') }}
            </Button>
            <Button
              xs
              icon="mdi:trash-can-outline"
              class="confirm-clear-btn"
              @click="confirmClear"
            >
              {{ t('history.clearConfirmButton') }}
            </Button>
          </span>
        </template>
        <template v-else>
          <span class="text-xs text-muted">
            {{ filtered.length }} / {{ items.length }}
          </span>
          <Button
            xs
            ghost
            icon="mdi:trash-can-outline"
            class="clear-btn"
            @click="confirmingClear = true"
          >
            {{ t('history.clear') }}
          </Button>
        </template>
      </div>

      <div ref="scroller" class="history-items">
        <section v-for="group in groups" :key="group.key" class="history-group">
          <h3 class="history-group-title">
            {{ group.labelKey ? t(group.labelKey) : group.label }}
          </h3>
          <div class="history-group-items">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="history-item"
              :data-history-id="item.id"
            >
              <div class="history-content">
                <div v-if="item.meta || item.time" class="history-meta">
                  <template v-if="item.meta">
                    <Icon :icon="item.meta.icon" height="14" />
                    <span>{{ item.meta.label }}</span>
                  </template>
                  <span v-if="item.time" class="history-date">
                    <time
                      :datetime="new Date(item.time).toISOString()"
                      :title="formatHistoryDateTime(item.time, locale)"
                    >
                      {{ formatHistoryTime(item.time, locale) }}
                    </time>
                  </span>
                </div>

                <div
                  v-if="item.value"
                  class="history-text-value"
                  :class="{ expanded: expanded.has(item.id) }"
                >
                  {{ item.value }}
                </div>
                <div v-else class="text-faint italic">
                  {{ t('common.empty') }}
                </div>

                <button
                  v-if="isLong(item)"
                  type="button"
                  class="history-expand-toggle"
                  @click="toggleExpanded(item)"
                >
                  <span>
                    {{
                      expanded.has(item.id)
                        ? t('history.collapse')
                        : t('history.expand')
                    }}
                  </span>
                  <Icon
                    :icon="
                      expanded.has(item.id)
                        ? 'mdi:chevron-up'
                        : 'mdi:chevron-down'
                    "
                    height="14"
                  />
                </button>
              </div>

              <div class="history-item-actions">
                <Button
                  v-for="action in visibleActions(item)"
                  :key="action.id"
                  xs
                  ghost
                  square
                  :title="action.title"
                  :class="action.danger ? 'danger-action' : undefined"
                  @click="emit('action', action.id, item)"
                >
                  <Icon :icon="action.icon" height="16" />
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import {
  formatHistoryDateTime,
  formatHistoryTime,
  groupByDay,
} from '../lib/history/history-list'
import Button from './common/Button.vue'
import { Icon } from '@iconify/vue'

const { t, locale } = useI18n()

export interface HistoryListItem {
  id: string
  value: string
  /** Why the entry is in the history, shown above the text. */
  meta?: { icon: string; label: string }
  /** Unix time in milliseconds; 0 or missing when unknown. */
  time?: number
  /** Additional localized terms included in search. */
  searchText?: string
}

export interface HistoryListAction {
  id: string
  icon: string
  title: string
  danger?: boolean
  isVisible?: (item: HistoryListItem) => boolean
}

const emit = defineEmits<{
  (e: 'open', item: HistoryListItem): void
  (e: 'action', actionId: string, item: HistoryListItem): void
  (e: 'clear'): void
}>()

const props = withDefaults(
  defineProps<{
    items: HistoryListItem[]
    searchQuery?: string
    openTitle?: string
    actions?: HistoryListAction[]
    emptyHint?: string
    /** Number affected by clearing; may be larger than a filtered list. */
    totalCount?: number
  }>(),
  {
    searchQuery: '',
    openTitle: '',
    actions: () => [],
    emptyHint: '',
    totalCount: 0,
  }
)

const scroller = ref<HTMLElement | null>(null)
const confirmingClear = ref(false)
const expanded = ref(new Set<string>())

const filtered = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase()

  if (!query) return props.items

  return props.items.filter((item) =>
    `${item.value || ''}\n${item.searchText || ''}`
      .toLowerCase()
      .includes(query)
  )
})

const groups = computed(() =>
  groupByDay(filtered.value, (item) => item.time ?? 0, Date.now(), locale.value)
)

watch(
  () => props.items.length,
  (length) => {
    if (length === 0) confirmingClear.value = false
  }
)

function visibleActions(item: HistoryListItem) {
  return props.actions.filter((action) => action.isVisible?.(item) ?? true)
}

function isLong(item: HistoryListItem) {
  if (!item.value) return false
  return item.value.length > 200 || item.value.split('\n').length > 3
}

function toggleExpanded(item: HistoryListItem) {
  const next = new Set(expanded.value)

  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)

  expanded.value = next
}

function confirmClear() {
  confirmingClear.value = false
  emit('clear')
}
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
  min-height: 1.75rem;
  padding: 0 var(--space-xs) var(--space-xs);
}

.history-toolbar-buttons {
  display: flex;
  gap: var(--space-xs);
}

.clear-btn {
  color: var(--app-text-muted);
}

.clear-btn:hover {
  color: var(--color-error);
}

.confirm-clear-btn {
  color: var(--color-error-content);
  background-color: var(--color-error);
  border-color: var(--color-error);
}

.history-items {
  flex: 1;
  min-height: 0;
  padding-right: var(--space-xs);
  overflow-y: auto;
}

.history-group + .history-group {
  margin-top: var(--space-md);
}

.history-group-title {
  margin: 0 0 var(--space-xs);
  padding: 0 var(--space-xs);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-muted);
  letter-spacing: 0.02em;
}

.history-group-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding: 0;
}

.history-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
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

.history-content {
  flex: 1;
  min-width: 0;
  cursor: default;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-2xs);
  font-size: 0.75rem;
  color: var(--app-text-muted);
  user-select: none;
}

.history-date {
  margin-left: auto;
  color: var(--app-text-faint);
}

.history-text-value {
  font-size: 0.875rem;
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

.history-expand-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: var(--space-xs);
  padding: 2px 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-primary);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--transition-fast);
}

.history-expand-toggle:hover {
  background-color: var(--app-hover);
  text-decoration: underline;
}

.history-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-top: 0.125rem;
  opacity: 0.7;
  transition: opacity var(--transition-fast);
}

.history-item:hover .history-item-actions,
.history-item:focus-within .history-item-actions {
  opacity: 1;
}

.history-item-actions :deep(.btn) {
  color: var(--app-text-muted);
}

.history-item-actions :deep(.btn:hover) {
  color: var(--color-base-content);
}

.danger-action:hover {
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
