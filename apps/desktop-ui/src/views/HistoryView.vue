<template>
  <div class="history-page">
    <div class="history-header">
      <SearchInput
        v-model="searchQuery"
        :placeholder="t('input.historySearchPlaceholder')"
        ref="searchInput"
      />
      <div class="history-filters">
        <SegmentedControl
          v-model:value="editorFilter"
          :label="t('history.filterLabel')"
          :options="editorFilterOptions"
        />
      </div>
    </div>

    <HistoryList
      :items="editorItems"
      :searchQuery="searchQuery"
      :openTitle="t('history.placeIntoEditor')"
      :actions="editorActions"
      :emptyHint="t('history.emptyHint')"
      :totalCount="historyStore.editorHistory.length"
      @open="toEditor"
      @action="onEditorAction"
      @clear="clearEditorHistory"
    >
      <template #notice>
        <div v-if="editorLoadError" class="history-notice is-error">
          <Icon icon="mdi:alert-circle-outline" height="16" />
          <span>{{ t('history.loadFailed') }}</span>
          <Button xs ghost icon="mdi:reload" @click="loadEditorHistory">
            {{ t('history.retry') }}
          </Button>
        </div>
        <div v-if="removedItem" class="history-notice">
          <Icon icon="mdi:trash-can-outline" height="16" />
          <span>{{ t('history.itemRemoved') }}</span>
          <Button xs ghost icon="mdi:undo" @click="undoRemove">
            {{ t('history.undo') }}
          </Button>
        </div>
        <div v-if="editorHistoryDisabled" class="history-notice">
          <Icon icon="mdi:information-outline" height="16" />
          <span>{{ t('history.textsDisabled') }}</span>
        </div>
      </template>
    </HistoryList>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import HistoryList, {
  type HistoryListAction,
  type HistoryListItem,
} from '../components/HistoryList.vue'
import Button from '../components/common/Button.vue'
import SearchInput from '../components/common/SearchInput.vue'
import SegmentedControl from '../components/common/SegmentedControl.vue'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { getEditorHistoryMeta } from '../lib/history/editor-history-meta'
import {
  type EditorHistoryFilter,
  filterEditorHistory,
} from '../lib/history/history-list'
import { useActionMenuStore } from '../stores/actionMenu'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { Icon } from '@iconify/vue'
import type { EditorHistoryItem } from '@tyco/shared'

const UNDO_TIMEOUT_MS = 8000

const toast = useToast()
const { t } = useI18n()
const navPanelStore = useNavPanelStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()
const routeParams = useRouteParams()

const editorFilter = ref<EditorHistoryFilter>('all')
const removedItem = ref<EditorHistoryItem | null>(null)
const editorLoadError = ref(false)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const editorFilterOptions = computed(() => [
  { id: 'all' as const, name: t('history.filterAll') },
  { id: 'output' as const, name: t('history.filterOutput') },
  { id: 'draft' as const, name: t('history.filterDraft') },
  { id: 'source' as const, name: t('history.filterSource') },
])

const isLimitZero = (value: unknown) => String(value ?? '').trim() === '0'
const editorHistoryDisabled = computed(() =>
  isLimitZero(ipcStore.params.userConfig?.editorHistoryMaxItems)
)

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)

const editorById = computed(
  () => new Map(historyStore.editorHistory.map((item) => [item.id, item]))
)

const editorItems = computed<HistoryListItem[]>(() =>
  filterEditorHistory(historyStore.editorHistory, editorFilter.value).map(
    (item) => {
      const meta = getEditorHistoryMeta(item)

      return {
        id: item.id,
        value: item.text,
        meta: { icon: meta.icon, label: t(meta.labelKey) },
        searchText: t(meta.labelKey),
        time: item.createdAt,
      }
    }
  )
)

const editorActions = computed<HistoryListAction[]>(() => [
  {
    id: 'toEditor',
    icon: 'mdi:pencil-outline',
    title: t('history.placeIntoEditor'),
  },
  {
    id: 'compare',
    icon: 'mdi:compare-horizontal',
    title: t('history.compare'),
    isVisible: (item) => !!editorById.value.get(item.id)?.result,
  },
  ...(ipcStore.params.windowId
    ? [
        {
          id: 'insert',
          icon: 'mdi:keyboard-outline',
          title: t('action.insertIntoWindow'),
        },
      ]
    : []),
  { id: 'copy', icon: 'mdi:content-copy', title: t('action.copyToClipboard') },
  {
    id: 'remove',
    icon: 'mdi:trash-can-outline',
    title: t('history.removeItem'),
    danger: true,
  },
])

onMounted(() => {
  searchInput.value?.focus()
  void loadEditorHistory()
})

onUnmounted(() => {
  clearTimeout(undoTimer)
})

navPanelStore.resetNavParams({})

const loadEditorHistory = async () => {
  try {
    await historyStore.loadEditorHistory()
    editorLoadError.value = false
  } catch {
    editorLoadError.value = true
  }
}

const reportOperationError = () => {
  toast.toast(t('history.operationFailed'), 'error')
}

const clearEditorHistory = async () => {
  hideUndo()
  try {
    await historyStore.clearEditorHistory()
    toast.toast(t('history.inputCleared'), 'success')
  } catch {
    reportOperationError()
  }
}

const hideUndo = () => {
  clearTimeout(undoTimer)
  removedItem.value = null
}

const removeEditorItem = async (item: HistoryListItem) => {
  let removed: EditorHistoryItem | null

  try {
    removed = await historyStore.removeFromEditorHistory(item.id)
  } catch {
    reportOperationError()
    return
  }

  if (!removed) return

  clearTimeout(undoTimer)
  removedItem.value = removed
  undoTimer = setTimeout(hideUndo, UNDO_TIMEOUT_MS)
}

const undoRemove = async () => {
  const item = removedItem.value

  hideUndo()

  if (!item) return

  try {
    await historyStore.restoreEditorItem(item)
  } catch {
    reportOperationError()
  }
}

const onEditorAction = async (actionId: string, item: HistoryListItem) => {
  const [insertAction, copyAction] = actionMenuStore.getDefaultActions()

  switch (actionId) {
    case 'toEditor':
      toEditor(item)
      break
    case 'compare': {
      const result = editorById.value.get(item.id)?.result

      if (result) {
        menuModalsStore.nextModal(MenuModals.DIFF, {
          oldText: item.value,
          newText: result,
        })
      }
      break
    }
    case 'insert':
      await insertAction?.action(item.value)
      break
    case 'copy':
      await copyAction?.action(item.value)
      break
    case 'remove':
      await removeEditorItem(item)
      break
  }
}

const toEditor = (item: HistoryListItem) => {
  routeParams.toEditor(item.value)
}
</script>

<style scoped>
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

.history-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-sm);
}

.history-notice {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  font-size: 0.8125rem;
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
}

.history-notice :deep(.btn) {
  margin-left: auto;
}

.history-notice.is-error {
  color: var(--color-error);
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--app-border));
}
</style>
