<template>
  <div class="history-list">
    <slot name="notice" />

    <div v-if="$slots.search || items.length > 0" class="history-header-row">
      <div class="history-search-col">
        <slot name="search" />
      </div>
      <div v-if="items.length > 0" class="history-toolbar-col">
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
    </div>

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
              <div
                v-if="item.meta || item.time || visibleActions(item).length"
                class="history-item-header"
              >
                <div v-if="item.meta || item.time" class="history-meta">
                  <template v-if="item.meta">
                    <span class="history-meta-badge">
                      <Icon :icon="item.meta.icon" height="14" />
                      <span>{{ item.meta.label }}</span>
                    </span>
                    <span v-if="item.meta.note" class="history-meta-note">
                      <Icon icon="mdi:check" height="12" />
                      {{ item.meta.note }}
                    </span>
                  </template>
                  <span v-if="item.time" class="history-date">
                    <span
                      v-if="item.meta"
                      class="history-meta-divider"
                      aria-hidden="true"
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

                <div
                  v-if="visibleActions(item).length"
                  class="history-item-actions"
                >
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

              <div class="history-content">
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

                <div v-if="item.original" class="history-original">
                  <button
                    type="button"
                    class="history-original-toggle"
                    :aria-expanded="originalShown.has(item.id)"
                    @click="toggleOriginal(item)"
                  >
                    <Icon
                      :icon="
                        originalShown.has(item.id)
                          ? 'mdi:chevron-down'
                          : 'mdi:chevron-right'
                      "
                      height="14"
                    />
                    <span>{{ item.original.label }}</span>
                  </button>
                  <div
                    v-if="originalShown.has(item.id)"
                    class="history-original-body"
                  >
                    <div class="history-original-text">
                      {{ item.original.text }}
                    </div>
                    <div class="history-original-actions">
                      <Button
                        v-for="action in originalActions"
                        :key="action.id"
                        xs
                        ghost
                        square
                        :title="action.title"
                        @click="emit('action', action.id, item)"
                      >
                        <Icon :icon="action.icon" height="16" />
                      </Button>
                    </div>
                  </div>
                </div>
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
  meta?: { icon: string; label: string; note?: string }
  /** The text `value` was made from, shown collapsed under it. */
  original?: { label: string; text: string }
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
    /** Shown next to an expanded `original`. */
    originalActions?: HistoryListAction[]
    emptyHint?: string
    /** Number affected by clearing; may be larger than a filtered list. */
    totalCount?: number
  }>(),
  {
    searchQuery: '',
    openTitle: '',
    actions: () => [],
    originalActions: () => [],
    emptyHint: '',
    totalCount: 0,
  }
)

const scroller = ref<HTMLElement | null>(null)
const confirmingClear = ref(false)
const expanded = ref(new Set<string>())
const originalShown = ref(new Set<string>())

const filtered = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase()

  if (!query) return props.items

  return props.items.filter((item) =>
    [item.value, item.original?.text, item.searchText]
      .join('\n')
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

function toggled(set: Set<string>, id: string) {
  const next = new Set(set)

  if (next.has(id)) next.delete(id)
  else next.add(id)

  return next
}

function toggleExpanded(item: HistoryListItem) {
  expanded.value = toggled(expanded.value, item.id)
}

function toggleOriginal(item: HistoryListItem) {
  originalShown.value = toggled(originalShown.value, item.id)
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

.history-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 2.25rem;
  margin-bottom: var(--space-sm);
  padding: 0 var(--space-xs);
}

.history-search-col {
  flex: 0 1 50%;
  min-width: 0;
}

.history-toolbar-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-xs);
  margin-left: auto;
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
  font-size: 0.75rem;
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

.history-original {
  margin-top: var(--space-xs);
}

.history-original-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 2px 6px 2px 2px;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--transition-fast);
}

.history-original-toggle:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
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
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--app-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
}

.history-original-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.history-original-actions :deep(.btn) {
  color: var(--app-text-muted);
}

.history-original-actions :deep(.btn:hover) {
  color: var(--color-base-content);
}

.history-item-actions {
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

.history-item-actions :deep(.btn) {
  color: var(--app-text-muted);
}

.history-item-actions :deep(.btn:hover) {
  color: var(--color-base-content);
}

.danger-action:hover {
  color: var(--color-error) !important;
}

@media (hover: none) {
  .history-item-actions {
    opacity: 1;
    pointer-events: auto;
  }
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
