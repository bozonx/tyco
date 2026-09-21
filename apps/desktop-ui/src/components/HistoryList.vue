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
            {{ t('history.clearConfirm', { count: items.length }) }}
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
        <section v-for="group in groups" :key="group.key">
          <h3 class="history-group-title">
            {{ group.labelKey ? t(group.labelKey) : group.label }}
          </h3>
          <ul class="history-group-items">
            <li
              v-for="item in group.items"
              :key="item.id"
              class="history-item"
              :class="{ 'is-current': item.id === currentId }"
              :data-history-id="item.id"
            >
              <button
                type="button"
                class="history-text"
                :title="openTitle"
                @click="emit('open', item)"
              >
                <span v-if="item.meta || item.time" class="history-meta">
                  <template v-if="item.meta">
                    <Icon :icon="item.meta.icon" height="14" />
                    <span>{{ item.meta.label }}</span>
                  </template>
                  <span v-if="item.time" class="history-date">
                    {{ formatHistoryTime(item.time, locale) }}
                  </span>
                </span>
                <span
                  v-if="item.value"
                  class="history-text-value"
                  :class="{ expanded: expanded.has(item.id) }"
                  >{{
                    expanded.has(item.id)
                      ? item.value
                      : truncate(item.value, 400)
                  }}</span
                >
                <span v-else class="text-faint italic">{{
                  t('common.empty')
                }}</span>
              </button>

              <div class="history-item-actions">
                <Button
                  v-if="isLong(item)"
                  xs
                  ghost
                  square
                  :title="
                    expanded.has(item.id)
                      ? t('history.collapse')
                      : t('history.expand')
                  "
                  @click="toggleExpanded(item)"
                >
                  <Icon
                    :icon="
                      expanded.has(item.id)
                        ? 'mdi:chevron-up'
                        : 'mdi:chevron-down'
                    "
                    height="16"
                  />
                </Button>
                <Button
                  v-for="action in visibleActions(item)"
                  :key="action.id"
                  xs
                  ghost
                  square
                  :title="actionTitle(action)"
                  :class="action.danger ? 'danger-action' : undefined"
                  @click="emit('action', action.id, item)"
                >
                  <Icon :icon="action.icon" height="16" />
                </Button>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <p v-if="active" class="history-hints">
        <span><KeyButton>↑</KeyButton><KeyButton>↓</KeyButton></span>
        <span><KeyButton>Enter</KeyButton> {{ openTitle }}</span>
        <span v-for="action in keyedActions" :key="action.id">
          <KeyButton>{{ action.keys }}</KeyButton> {{ action.title }}
        </span>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { formatHistoryTime, groupByDay } from '../lib/history/history-list'
import { truncate } from '@/lib/squidlet-lib-local'
import { Icon } from '@iconify/vue'

const { t, locale } = useI18n()

export interface HistoryListItem {
  id: string
  value: string
  /** Why the entry is in the history, shown above the text. */
  meta?: { icon: string; label: string }
  /** Unix time in milliseconds; 0 or missing when unknown. */
  time?: number
}

export interface HistoryListAction {
  id: string
  icon: string
  title: string
  /** Shortcut for the highlighted entry, like `Ctrl+Enter`. */
  keys?: string
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
    /** The list owns the keyboard: arrows, Enter and action shortcuts. */
    active?: boolean
  }>(),
  {
    searchQuery: '',
    openTitle: '',
    actions: () => [],
    emptyHint: '',
    active: false,
  }
)

const scroller = ref<HTMLElement | null>(null)
const confirmingClear = ref(false)
const expanded = ref(new Set<string>())
const currentId = ref<string | null>(null)

const filtered = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase()

  if (!query) return props.items

  return props.items.filter((item) =>
    (item.value || '').toLowerCase().includes(query)
  )
})

const groups = computed(() =>
  groupByDay(filtered.value, (item) => item.time ?? 0, Date.now(), locale.value)
)

/** Entries in the order they are shown, for the arrow keys. */
const ordered = computed(() => groups.value.flatMap((group) => group.items))

const keyedActions = computed(() =>
  props.actions.filter((action) => action.keys)
)

watch(
  ordered,
  (items) => {
    if (!items.some((item) => item.id === currentId.value)) {
      currentId.value = items[0]?.id ?? null
    }
  },
  { immediate: true }
)

watch(
  () => props.searchQuery,
  () => {
    currentId.value = ordered.value[0]?.id ?? null
  }
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

function actionTitle(action: HistoryListAction) {
  return action.keys ? `${action.title} (${action.keys})` : action.title
}

function isLong(item: HistoryListItem) {
  return item.value.length > 280 || item.value.split('\n').length > 3
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

function moveCurrent(step: number) {
  const items = ordered.value

  if (items.length === 0) return

  const index = items.findIndex((item) => item.id === currentId.value)
  const nextIndex = Math.min(Math.max(index + step, 0), items.length - 1)

  currentId.value = items[nextIndex]!.id

  void nextTick(() => {
    scroller.value
      ?.querySelector(`[data-history-id="${CSS.escape(currentId.value!)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function shortcutOf(event: KeyboardEvent): string {
  const key =
    event.key === ' '
      ? 'Space'
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key

  return [
    event.ctrlKey || event.metaKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+')
}

/** Focused controls with keys of their own: buttons, radio groups and such. */
const OWN_KEYS_SELECTOR = 'button, a, select, textarea, input[type="radio"]'

function handleKeyDown(event: KeyboardEvent) {
  if (!props.active || event.isComposing) return
  if ((event.target as Element | null)?.closest?.(OWN_KEYS_SELECTOR)) return

  const shortcut = shortcutOf(event)

  if (shortcut === 'ArrowDown' || shortcut === 'ArrowUp') {
    event.preventDefault()
    moveCurrent(shortcut === 'ArrowDown' ? 1 : -1)
    return
  }

  const current = ordered.value.find((item) => item.id === currentId.value)

  if (!current) return

  if (shortcut === 'Enter') {
    event.preventDefault()
    emit('open', current)
    return
  }

  const action = visibleActions(current).find(
    (action) => action.keys === shortcut
  )

  if (action) {
    event.preventDefault()
    emit('action', action.id, current)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
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
  min-height: 1.75rem;
  padding: 0 var(--space-xs) var(--space-sm);
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
  flex: 0 1 auto;
  min-height: 0;
  margin: 0 0 var(--space-sm);
  overflow-y: auto;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
}

.history-group-title {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-xs) var(--space-lg);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--app-text-muted);
  background-color: var(--app-surface-sunken);
  border-bottom: 1px solid var(--app-border-subtle);
}

section + section .history-group-title {
  border-top: 1px solid var(--app-border-subtle);
}

.history-group-items {
  margin: 0;
  padding: 0;
  list-style: none;
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

.history-item:hover,
.history-item.is-current {
  background-color: var(--app-hover);
}

.history-item.is-current {
  box-shadow: inset 3px 0 0 var(--color-primary);
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

.history-text-value.expanded {
  display: block;
  -webkit-line-clamp: unset;
  white-space: pre-wrap;
}

.history-item-actions {
  display: flex;
  gap: 2px;
  padding-top: 0.375rem;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.history-item:hover .history-item-actions,
.history-item.is-current .history-item-actions,
.history-item:focus-within .history-item-actions {
  opacity: 1;
}

.history-item-actions :deep(.btn) {
  color: var(--app-text-muted);
}

.danger-action:hover {
  color: var(--color-error) !important;
}

.history-hints {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
  margin: 0 0 var(--space-lg);
  padding: 0 var(--space-xs);
  font-size: 0.75rem;
  color: var(--app-text-muted);
}

.history-hints > span {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
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
