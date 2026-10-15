<template>
  <div class="history-list">
    <slot name="notice" />

    <div v-if="$slots.search || items.length > 0" class="history-header-row">
      <div class="history-search-col">
        <slot name="search" />
      </div>
      <div v-if="items.length > 0" class="history-toolbar-col">
        <HistoryClearActions :total-count="totalCount" @clear="emit('clear')" />
      </div>
    </div>

    <StateMessage
      v-if="filtered.length === 0"
      class="history-empty"
      :icon="searchQuery ? 'mdi:text-search' : 'mdi:history'"
      :title="searchQuery ? t('history.nothingFound') : t('history.empty')"
      :message="!searchQuery ? emptyHint : undefined"
    />

    <template v-else>
      <div ref="scroller" class="history-items">
        <section v-for="group in groups" :key="group.key" class="history-group">
          <h3 class="history-group-title">
            {{ group.labelKey ? t(group.labelKey) : group.label }}
          </h3>
          <div class="history-group-items">
            <HistoryListItemView
              v-for="item in group.items"
              :key="item.id"
              :item="item"
              :expanded="expandedIds.has(item.id)"
              :original-shown="originalShownIds.has(item.id)"
              @toggle-expanded="toggleItem(expandedIds, item.id)"
              @toggle-original="toggleItem(originalShownIds, item.id)"
              :actions="actions"
              :original-actions="originalActions"
              @action="(actionId, item) => emit('action', actionId, item)"
            />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { groupByDay } from '../../lib/history/history-list'
import type {
  HistoryListAction,
  HistoryListItem,
} from '../../lib/history/history-list-types'
import StateMessage from '../common/StateMessage.vue'
import HistoryClearActions from './HistoryClearActions.vue'
import HistoryListItemView from './HistoryListItem.vue'

const { t, locale } = useI18n()

export type {
  HistoryListItem,
  HistoryListAction,
} from '../../lib/history/history-list-types'

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
const expandedIds = ref(new Set<string>())
const originalShownIds = ref(new Set<string>())
function toggleItem(items: Set<string>, id: string) {
  if (items.has(id)) items.delete(id)
  else items.add(id)
}

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
  font-size: var(--text-caption);
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
</style>
