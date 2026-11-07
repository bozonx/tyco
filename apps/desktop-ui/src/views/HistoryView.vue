<template>
  <div class="history-page">
    <HistoryList
      :items="editorItems"
      :search-query="searchQuery"
      :open-title="t('history.placeIntoEditor')"
      :actions="editorActions"
      :original-actions="originalActions"
      :empty-hint="t('history.emptyHint')"
      :total-count="historyStore.editorHistory.length"
      :is-filtered="isFiltered"
      @open="toEditor"
      @action="onEditorAction"
      @clear="clearEditorHistory"
    >
      <template #search>
        <div class="history-search">
          <SearchInput
            ref="searchInput"
            v-model="searchQuery"
            :placeholder="t('input.historySearchPlaceholder')"
          />
          <div class="history-filters">
            <SegmentedControl
              v-model="filter.origin"
              size="sm"
              :label="t('history.filterOrigin')"
              :options="originOptions"
            />
            <FieldCheckbox
              v-model="filter.isUnsentOnly"
              :label="t('history.filterUnsent')"
              :title="t('history.filterUnsentHint')"
            />
          </div>
        </div>
      </template>

      <template #notice>
        <InlineNotice
          v-if="hasEditorLoadError"
          class="history-notice is-error"
          kind="error"
          announcement="assertive"
          icon="mdi:alert-circle-outline"
          :message="t('history.loadFailed')"
          appearance="sunken"
          density="compact"
        >
          <Button
            size="xs"
            variant="ghost"
            icon="mdi:reload"
            @click="loadEditorHistory"
          >
            {{ t('history.retry') }}
          </Button>
        </InlineNotice>
        <InlineNotice
          v-if="removedItem"
          class="history-notice"
          kind="info"
          announcement="polite"
          icon="mdi:trash-can-outline"
          :message="t('history.itemRemoved')"
          appearance="sunken"
          density="compact"
        >
          <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemove">
            {{ t('history.undo') }}
          </Button>
        </InlineNotice>
        <InlineNotice
          v-if="isEditorHistoryDisabled"
          class="history-notice"
          kind="info"
          announcement="polite"
          icon="mdi:information-outline"
          :message="t('history.textsDisabled')"
          appearance="sunken"
          density="compact"
        />
      </template>
    </HistoryList>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import Button from '../components/common/Button.vue'
import FieldCheckbox from '../components/common/FieldCheckbox.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import SearchInput from '../components/common/SearchInput.vue'
import SegmentedControl from '../components/common/SegmentedControl.vue'
import HistoryList, {
  type HistoryListAction,
  type HistoryListItem,
} from '../components/history/HistoryList.vue'
import { useCopyText } from '../composables/use-copy-text'
import { useEditorHistoryChanges } from '../composables/use-editor-history-changes'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import { getEditorHistoryView } from '../lib/history/editor-history-meta'
import { isEditorHistoryOff } from '../lib/history/editor-history-storage'
import {
  DEFAULT_HISTORY_FILTER,
  HISTORY_ORIGIN_FILTERS,
  type HistoryFilter,
  type HistoryOriginFilter,
  filterEditorHistory,
} from '../lib/history/history-filter'
import { createRemovalUndo } from '../lib/history/removal-undo'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from '../stores/desktop'
import { useHistoryStore } from '../stores/history'
import type { EditorHistoryItem } from '@tyco/shared'

const { toastKey } = useToast()
const { t } = useI18n()
const historyStore = useHistoryStore()
const desktopStore = useDesktopStore()
// the text is already in the history and the window stays open
const copyText = useCopyText({ saveOutput: false })
const editorNavigation = useEditorNavigation()

const removal = createRemovalUndo<EditorHistoryItem>({
  remove: historyStore.removeFromEditorHistory,
  restore: historyStore.restoreEditorItem,
  clear: historyStore.clearEditorHistory,
  reportError: (error) => {
    clientLogger.warn(
      `An editor history operation failed: ${String(error)}`,
      'history'
    )
    toastKey('history.operationFailed', 'error')
  },
})
const removedItem = removal.removed
const undoRemove = removal.undo
const clearEditorHistory = removal.clear
const hasEditorLoadError = ref(false)

const isEditorHistoryDisabled = computed(() =>
  isEditorHistoryOff(desktopStore.userConfig)
)

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)

const ORIGIN_FILTER_LABELS: Record<HistoryOriginFilter, string> = {
  all: 'history.filterAll',
  quickInput: 'history.filterQuickInput',
  voice: 'history.filterVoice',
}
const originOptions = computed(() =>
  HISTORY_ORIGIN_FILTERS.map((id) => ({
    id,
    name: t(ORIGIN_FILTER_LABELS[id]),
  }))
)

const filter = reactive<HistoryFilter>({ ...DEFAULT_HISTORY_FILTER })
const isFiltered = computed(
  () =>
    filter.origin !== DEFAULT_HISTORY_FILTER.origin ||
    filter.isUnsentOnly !== DEFAULT_HISTORY_FILTER.isUnsentOnly
)
// an activation may open the history filtered, e.g. from the quick input
watch(
  () =>
    desktopStore.desktopState.mode === 'history'
      ? desktopStore.desktopState.activationId
      : undefined,
  (activationId) => {
    if (activationId === undefined) return
    Object.assign(filter, DEFAULT_HISTORY_FILTER, {
      origin: desktopStore.desktopState.historyOrigin ?? 'all',
    })
  },
  { immediate: true }
)

const editorItems = computed<HistoryListItem[]>(() =>
  filterEditorHistory(historyStore.editorHistory, filter).map((item) => {
    const view = getEditorHistoryView(item)
    const label = t(view.labelKey)

    return {
      id: item.id,
      value: view.text,
      meta: {
        icon: view.icon,
        label,
        note: view.isResultApplied ? t('history.sent') : undefined,
      },
      original: view.original && {
        label: t(view.original.labelKey),
        text: view.original.text,
      },
      turns: view.turns?.map((turn) => ({
        prompt: turn.prompt,
        result: turn.result,
        isVoice: turn.inputKind === 'voice',
      })),
      searchText: [
        label,
        ...(view.turns ?? []).flatMap((turn) => [
          turn.prompt,
          turn.result || '',
        ]),
      ].join(' '),
      time: item.createdAt,
    }
  })
)

const editorActions = computed<HistoryListAction[]>(() => [
  {
    id: 'toEditor',
    icon: 'mdi:pencil-outline',
    title: t('history.placeIntoEditor'),
  },
  { id: 'copy', icon: 'mdi:content-copy', title: t('action.copy') },
  {
    id: 'remove',
    icon: 'mdi:trash-can-outline',
    title: t('history.removeItem'),
  },
])

const originalActions = computed<HistoryListAction[]>(() => [
  {
    id: 'originalToEditor',
    icon: 'mdi:pencil-outline',
    title: t('history.originalToEditor'),
  },
  {
    id: 'copyOriginal',
    icon: 'mdi:content-copy',
    title: t('history.copyOriginal'),
  },
])

onMounted(() => {
  searchInput.value?.focus()
  void loadEditorHistory()
})

onUnmounted(() => {
  void removal.dispose()
})

const loadEditorHistory = async () => {
  try {
    await historyStore.loadEditorHistory()
    hasEditorLoadError.value = false
  } catch (error) {
    clientLogger.warn(
      `Could not load the editor history: ${String(error)}`,
      'history'
    )
    hasEditorLoadError.value = true
  }
}

// another window or the settings changed it
useEditorHistoryChanges(() => void loadEditorHistory())

const removeEditorItem = (item: HistoryListItem) => removal.remove(item.id)

const onEditorAction = async (actionId: string, item: HistoryListItem) => {
  switch (actionId) {
    case 'toEditor':
      toEditor(item)
      break
    case 'copy':
      await copyText(item.value)
      break
    case 'originalToEditor':
      if (item.original) editorNavigation.toEditor(item.original.text)
      break
    case 'copyOriginal':
      if (item.original) await copyText(item.original.text)
      break
    case 'remove':
      await removeEditorItem(item)
      break
  }
}

const toEditor = (item: HistoryListItem) => {
  editorNavigation.toEditor(item.value)
}
</script>

<style scoped>
.history-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm) var(--space-md);
}

.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  max-width: 880px;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-xl) 0;
}

.history-notice {
  margin-bottom: var(--space-sm);
}

.history-notice.is-error {
  color: var(--color-error);
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--app-border));
}
</style>
