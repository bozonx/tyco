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
        <StateMessage
          v-if="hasEditorLoadError"
          class="history-notice is-error"
          kind="error"
          inline
          icon="mdi:alert-circle-outline"
          :message="t('history.loadFailed')"
        >
          <Button
            size="xs"
            variant="ghost"
            icon="mdi:reload"
            @click="loadEditorHistory"
          >
            {{ t('history.retry') }}
          </Button>
        </StateMessage>
        <StateMessage
          v-if="removedItem"
          class="history-notice"
          kind="info"
          inline
          icon="mdi:trash-can-outline"
          :message="t('history.itemRemoved')"
        >
          <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemove">
            {{ t('history.undo') }}
          </Button>
        </StateMessage>
        <StateMessage
          v-if="isEditorHistoryDisabled"
          class="history-notice"
          kind="info"
          inline
          icon="mdi:information-outline"
          :message="t('history.textsDisabled')"
        />
      </template>
    </HistoryList>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import Button from '../components/common/Button.vue'
import SearchInput from '../components/common/SearchInput.vue'
import StateMessage from '../components/common/StateMessage.vue'
import HistoryList, {
  type HistoryListAction,
  type HistoryListItem,
} from '../components/history/HistoryList.vue'
import { useCopyText } from '../composables/use-copy-text'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import { getEditorHistoryView } from '../lib/history/editor-history-meta'
import { isEditorHistoryOff } from '../lib/history/editor-history-storage'
import { createRemovalUndo } from '../lib/history/removal-undo'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/nav-panel'
import type { EditorHistoryItem } from '@tyco/shared'

const { toastKey } = useToast()
const { t } = useI18n()
const navPanelStore = useNavPanelStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
// the text is already in the history and the window stays open
const copyText = useCopyText({ saveOutput: false })
const editorNavigation = useEditorNavigation()

const removal = createRemovalUndo<EditorHistoryItem>({
  remove: historyStore.removeFromEditorHistory,
  restore: historyStore.restoreEditorItem,
  clear: historyStore.clearEditorHistory,
  reportError: () => toastKey('history.operationFailed', 'error'),
})
const removedItem = removal.removed
const undoRemove = removal.undo
const clearEditorHistory = removal.clear
const hasEditorLoadError = ref(false)

const isEditorHistoryDisabled = computed(() =>
  isEditorHistoryOff({ ...ipcStore.desktopState.userConfig })
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
  void removal.dispose()
})

navPanelStore.resetNavPanelState({})

const loadEditorHistory = async () => {
  try {
    await historyStore.loadEditorHistory()
    hasEditorLoadError.value = false
  } catch {
    hasEditorLoadError.value = true
  }
}

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
