<template>
  <div class="history-page">
    <HistoryList
      :items="editorItems"
      :search-query="searchQuery"
      :open-title="t('history.placeIntoEditor')"
      :actions="editorActions"
      :original-actions="originalActions"
      :empty-hint="t('history.emptyHint')"
      :is-filtered="isFiltered"
      :is-loading="isEditorHistoryLoading"
      @open="toEditor"
      @action="onEditorAction"
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
  type HistoryListItemFile,
} from '../components/history/HistoryList.vue'
import { useCopyText } from '../composables/use-copy-text'
import { useEditorHistoryChanges } from '../composables/use-editor-history-changes'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useI18n } from '../composables/use-i18n'
import { useSoundCaptureActivity } from '../composables/use-sound-capture-activity'
import useToast from '../composables/use-toast'
import { convertFileSrc } from '../lib/desktop/window'
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
import { loadRecordingMediaSource } from '../lib/history/recording-media-url'
import { createRemovalUndo } from '../lib/history/removal-undo'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from '../stores/desktop'
import { useDialogStatusStore } from '../stores/dialog-status'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import type { EditorHistoryDialog, EditorHistoryItem } from '@tyco/shared'

const { toastKey } = useToast()
const { t } = useI18n()
const historyStore = useHistoryStore()
const desktopStore = useDesktopStore()
const dialogStatus = useDialogStatusStore()
const ipcStore = useIpcStore()
// the text is already in the history and the window stays open
const copyText = useCopyText({ saveOutput: false })
const editorNavigation = useEditorNavigation()

const removal = createRemovalUndo<EditorHistoryItem>({
  remove: historyStore.removeFromEditorHistory,
  restore: historyStore.restoreEditorItem,
  release: historyStore.releaseEditorItem,
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
  voiceCommands: 'action.voiceCommands',
  listen: 'history.filterListen',
  dialog: 'history.kindDialog',
  quickAiRequest: 'chat.quickAiRequests',
  translation: 'history.kindTranslate',
  aiTask: 'history.kindAiTask',
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

const recordingFilesOfItem = (
  dialog?: EditorHistoryDialog | null
): string[] => {
  if (!dialog) return []
  if (dialog.recordingFiles?.length) return dialog.recordingFiles
  return dialog.recordingFile ? [dialog.recordingFile] : []
}

const editorItems = computed<HistoryListItem[]>(() =>
  filterEditorHistory(historyStore.editorHistory, filter.value).map((item) => {
    const view = getEditorHistoryView(item)
    const label = t(view.labelKey)
    const note = getEditorHistoryNote(item)
    const files = recordingFilesOfItem(item.dialog)
    const fileItems = files.map((file) =>
      recordingFile(file, item.dialog?.isRecordingIncomplete ?? false)
    )

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
      ...(fileItems.length === 1 && { file: fileItems[0] }),
      ...(fileItems.length > 1 && { files: fileItems }),
      ...(fileItems.length > 0 && {
        filesSection: {
          title: t('history.recordings'),
          action: {
            id: 'openRecordingsFolder',
            icon: 'mdi:folder-open-outline',
            title: t('settings.storageOpenFolder'),
          },
        },
      }),
    }
  })
)

/** Whether each recording a dialog entry names is there */
const recordingExists = ref<Record<string, boolean>>({})
const recordingFiles = computed(() =>
  historyStore.editorHistory.flatMap((item) =>
    recordingFilesOfItem(item.dialog)
  )
)
let recordingCheck = 0
const checkRecordings = async () => {
  const check = ++recordingCheck
  const files = [...new Set(recordingFiles.value)]
  if (!files.length) {
    recordingExists.value = {}
    return
  }
  const result = await ipcStore.call('check_dialog_recordings', { files })
  if (check !== recordingCheck || !result.success || !result.result) return
  const exists = result.result
  recordingExists.value = Object.fromEntries(
    files.map((file, index) => [file, exists[index] ?? false])
  )
}
// a running dialog rewrites its entry often: only other files are checked again
watch(
  () => [...new Set(recordingFiles.value)].sort().join('\n'),
  () => void checkRecordings(),
  { immediate: true }
)
// Sync can add or remove a file without changing its history entry.
watch(
  [() => desktopStore.desktopState.isWindowShown, () => dialogStatus.isActive],
  ([isShown, isDialogActive], _, onCleanup) => {
    if (!isShown) return
    if (!isDialogActive) void checkRecordings()
    const timer = setInterval(() => {
      if (recordingFiles.value.length) void checkRecordings()
    }, 5_000)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true }
)

const isSoundCaptured = useSoundCaptureActivity()

const readRecording = async (file: string): Promise<ArrayBuffer> => {
  const result = await ipcStore.call('read_dialog_recording', { file })
  if (!result.success || !result.result) {
    throw new Error(result.error ?? 'Could not read the recording')
  }
  return result.result
}

const recordingFile = (
  file: string,
  isIncomplete: boolean
): HistoryListItemFile => ({
  name: file,
  // unknown until checked: the action is offered
  isMissing: recordingExists.value[file] === false,
  missingLabel: t('history.recordingNotFound'),
  ...(isIncomplete && { note: t('history.recordingIncomplete') }),
  playback: {
    source: () => loadRecordingMediaSource(file, convertFileSrc, readRecording),
    playTitle: t('history.playRecording'),
    stopTitle: t('history.stopRecording'),
    speedTitle: t('history.playbackSpeed'),
    // the sound would go into what is recorded or transcribed: a dialog,
    // listening or a dictation through the speakers
    ...((dialogStatus.isActive || isSoundCaptured.value) && {
      disabledTitle: t('history.playRecordingWhileCapturing'),
    }),
    unavailableLabel: t('history.recordingUnplayable'),
  },
})

const openRecordingsFolder = async () => {
  const result = await ipcStore.callOrNotify('open_recordings_folder')
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
    case 'openRecordingsFolder':
      await openRecordingsFolder()
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
  width: 100%;
  min-width: 0;
}

.history-filters :deep(.segmented-control) {
  display: inline-flex;
  flex-wrap: wrap;
  white-space: normal;
  max-width: 100%;
  flex-shrink: 1;
  min-width: 0;
  row-gap: 4px;
}

.history-filters :deep(.segmented-option) {
  white-space: nowrap;
}

.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--space-md) var(--space-lg) 0;
}

.history-notice {
  margin-bottom: var(--space-sm);
}

.history-notice.is-error {
  color: var(--color-error);
  border-color: color-mix(in srgb, var(--color-error) 35%, var(--app-border));
}
</style>
