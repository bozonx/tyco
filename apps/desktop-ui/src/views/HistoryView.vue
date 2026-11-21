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
      :is-loading="isEditorHistoryLoading"
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
              v-model="filter"
              size="sm"
              :label="t('history.filterLabel')"
              :options="filterOptions"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import Button from '../components/common/Button.vue'
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
import { recordingFileName } from '../lib/dialog/dialog-recording'
import {
  getEditorHistoryNote,
  getEditorHistoryView,
} from '../lib/history/editor-history-meta'
import { isEditorHistoryOff } from '../lib/history/editor-history-storage'
import {
  DEFAULT_HISTORY_FILTER,
  HISTORY_FILTERS,
  type HistoryFilter,
  filterEditorHistory,
} from '../lib/history/history-filter'
import { createRemovalUndo } from '../lib/history/removal-undo'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from '../stores/desktop'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import type { EditorHistoryItem } from '@tyco/shared'

const { toastKey } = useToast()
const { t } = useI18n()
const historyStore = useHistoryStore()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
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
const isEditorHistoryLoading = computed(
  () => !historyStore.isEditorHistoryLoaded && !hasEditorLoadError.value
)

const isEditorHistoryDisabled = computed(() =>
  isEditorHistoryOff(desktopStore.userConfig)
)

const searchQuery = ref<string>('')
const searchInput = ref<HTMLInputElement | null>(null)

const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: 'history.filterAll',
  quickInput: 'history.filterQuickInput',
  voice: 'history.filterVoice',
  listen: 'history.filterListen',
  quickAiRequest: 'chat.quickAiRequests',
  problems: 'history.filterProblems',
}
const filterOptions = computed(() =>
  HISTORY_FILTERS.map((id) => ({
    id,
    name: t(FILTER_LABELS[id]),
    ...(id === 'problems' && { title: t('history.filterProblemsHint') }),
  }))
)

const filter = ref<HistoryFilter>(DEFAULT_HISTORY_FILTER)
const isFiltered = computed(() => filter.value !== DEFAULT_HISTORY_FILTER)
// an activation may open the history filtered, e.g. from the quick input
watch(
  () =>
    desktopStore.desktopState.mode === 'history'
      ? desktopStore.desktopState.activationId
      : undefined,
  (activationId) => {
    if (activationId === undefined) return
    filter.value =
      desktopStore.desktopState.historyOrigin ?? DEFAULT_HISTORY_FILTER
  },
  { immediate: true }
)

const editorItems = computed<HistoryListItem[]>(() =>
  filterEditorHistory(historyStore.editorHistory, filter.value).map((item) => {
    const view = getEditorHistoryView(item)
    const label = t(view.labelKey)
    const note = getEditorHistoryNote(item)

    return {
      id: item.id,
      value: view.text,
      meta: {
        icon: view.icon,
        label,
        note: note ? t(note.labelKey) : undefined,
        noteTone: note?.tone,
        noteIcon: note?.icon,
        noteDetail: note?.detail,
      },
      original: view.original && {
        label: t(view.original.labelKey),
        text: view.original.text,
      },
      searchText: label,
      time: item.createdAt,
      ...(item.dialog?.recordingPath && {
        file: recordingFile(
          item.dialog.recordingPath,
          item.dialog.isRecordingIncomplete ?? false
        ),
      }),
    }
  })
)

/** Whether each recording a dialog entry links to is still there */
const recordingExists = ref<Record<string, boolean>>({})
const recordingPaths = computed(() =>
  historyStore.editorHistory.flatMap((item) =>
    item.dialog?.recordingPath ? [item.dialog.recordingPath] : []
  )
)
const checkRecordings = async () => {
  const paths = [...new Set(recordingPaths.value)]
  if (!paths.length) return
  const result = await ipcStore.call('check_dialog_recordings', { paths })
  if (!result.success || !result.result) return
  const exists = result.result
  recordingExists.value = Object.fromEntries(
    paths.map((path, index) => [path, exists[index] ?? false])
  )
}
// a running dialog rewrites its entry often: only other paths are checked again
watch(
  () => [...new Set(recordingPaths.value)].sort().join('\n'),
  () => void checkRecordings(),
  { immediate: true }
)
// a file may have been moved or deleted while the window was hidden
watch(
  () => desktopStore.desktopState.isWindowShown,
  (isShown) => {
    if (isShown) void checkRecordings()
  }
)

const recordingFile = (
  path: string,
  isIncomplete: boolean
): HistoryListItem['file'] => ({
  name: recordingFileName(path),
  // unknown until checked: the action is offered
  isMissing: recordingExists.value[path] === false,
  missingLabel: t('history.recordingNotFound'),
  ...(isIncomplete && { note: t('history.recordingIncomplete') }),
  action: {
    id: 'showRecording',
    icon: 'mdi:folder-open-outline',
    title: t('history.showInFolder'),
  },
})

const showRecording = async (item: HistoryListItem) => {
  const path = historyStore.editorHistory.find((entry) => entry.id === item.id)
    ?.dialog?.recordingPath
  if (!path) return
  const result = await ipcStore.callOrNotify('show_dialog_recording', { path })
  if (!result.success) void checkRecordings()
}

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
    case 'showRecording':
      await showRecording(item)
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
  align-items: center;
  /* a narrow window scrolls the filters instead of wrapping them */
  overflow-x: auto;
}

.history-filters :deep(.segmented-control) {
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.history-filters :deep(.segmented-option) {
  white-space: nowrap;
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
