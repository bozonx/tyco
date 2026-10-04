<template>
  <div class="history-page">
    <HistoryList
      :items="editorItems"
      :searchQuery="searchQuery"
      :openTitle="t('history.placeIntoEditor')"
      :actions="editorActions"
      :originalActions="originalActions"
      :emptyHint="t('history.emptyHint')"
      :totalCount="historyStore.editorHistory.length"
      @open="toEditor"
      @action="onEditorAction"
      @clear="clearEditorHistory"
    >
      <template #search>
        <SearchInput
          ref="searchInput"
          v-model="searchQuery"
          :placeholder="t('input.historySearchPlaceholder')"
        />
      </template>

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
import { useCopyText } from '../composables/useCopyText'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { getEditorHistoryView } from '../lib/history/editor-history-meta'
import { isEditorHistoryOff } from '../lib/history/editor-history-storage'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
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
// the text is already in the history and the window stays open
const copyText = useCopyText({ saveOutput: false })
const routeParams = useRouteParams()

const removedItem = ref<EditorHistoryItem | null>(null)
const editorLoadError = ref(false)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const editorHistoryDisabled = computed(() =>
  isEditorHistoryOff({ ...ipcStore.params.userConfig })
)

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)

const editorItems = computed<HistoryListItem[]>(() =>
  historyStore.editorHistory.map((item) => {
    const view = getEditorHistoryView(item)
    const label = t(view.labelKey)

    return {
      id: item.id,
      value: view.text,
      meta: {
        icon: view.icon,
        label,
        note: view.sent ? t('history.sent') : undefined,
      },
      original: view.original && {
        label: t(view.original.labelKey),
        text: view.original.text,
      },
      searchText: label,
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
    danger: true,
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
  switch (actionId) {
    case 'toEditor':
      toEditor(item)
      break
    case 'copy':
      await copyText(item.value)
      break
    case 'originalToEditor':
      if (item.original) routeParams.toEditor(item.original.text)
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
