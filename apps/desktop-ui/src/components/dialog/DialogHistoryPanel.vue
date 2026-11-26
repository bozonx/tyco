<template>
  <aside class="dialog-history-panel" :aria-label="t('dialog.history')">
    <div class="panel-header">
      <Button
        variant="primary"
        class="flex-1"
        size="sm"
        icon="mdi:plus"
        :disabled="dialog.isActive"
        @click="startNewDialog"
      >
        {{ t('dialog.newDialog') }}
      </Button>
      <IconButton
        size="sm"
        variant="ghost"
        :active="isSearchOpen"
        :label="t('dialog.searchHistory')"
        icon="mdi:magnify"
        @click="toggleSearch"
      />
    </div>

    <InlineNotice
      v-if="removedDialog"
      class="panel-notice"
      announcement="polite"
      icon="mdi:trash-can-outline"
      :message="t('history.itemRemoved')"
      appearance="surface"
      density="compact"
    >
      <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemove">
        {{ t('history.undo') }}
      </Button>
    </InlineNotice>

    <SearchInput
      v-if="isSearchOpen"
      ref="searchInputRef"
      v-model="query"
      class="panel-search"
      size="sm"
      quiet
      :placeholder="t('dialog.searchHistory')"
      @keydown.esc="closeSearch"
    />

    <div class="dialog-list-scroll">
      <StateMessage
        v-if="groups.length === 0"
        class="dialog-list-empty"
        :message="query ? t('history.nothingFound') : t('history.empty')"
      />
      <section v-for="group in groups" :key="group.key" class="dialog-group">
        <h2>{{ t(`chat.group.${group.key}`) }}</h2>
        <ul class="dialog-list">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="dialog-list-row"
          >
            <form
              v-if="renamingId === item.id"
              class="rename-form"
              @submit.prevent="finishRename(item)"
            >
              <input
                ref="renameInputs"
                v-model="renameValue"
                :maxlength="MAX_DIALOG_TITLE_LENGTH"
                :aria-label="t('dialog.renameDialog')"
                @keydown.esc="cancelRename"
                @blur="finishRename(item)"
              />
            </form>
            <template v-else>
              <button
                type="button"
                class="dialog-list-item"
                :disabled="dialog.isActive"
                :class="{ 'is-active': dialog.currentDialogId === item.id }"
                :title="itemTooltip(item)"
                @pointerdown="preventMouseFocus"
                @click="selectDialog(item.id)"
              >
                <AppIcon
                  :icon="sourceIcon(item)"
                  size="sm"
                  class="shrink-0 dialog-item-icon"
                />
                <div class="dialog-item-body">
                  <span class="dialog-item-title">{{ itemLabel(item) }}</span>
                  <span class="dialog-item-meta">
                    <span
                      :title="formatHistoryDateTime(item.startedAt, locale)"
                      >{{ formatDialogStartTime(item.startedAt) }}</span
                    >
                    <span v-if="item.durationMs > 0">
                      · {{ formatDialogDuration(item.durationMs, locale) }}
                    </span>
                    <span
                      v-if="item.recordingCount > 0"
                      class="dialog-item-rec"
                      :title="t('history.recordings')"
                    >
                      <AppIcon icon="mdi:waveform" size="xs" />
                      <span v-if="item.recordingCount > 1">{{
                        item.recordingCount
                      }}</span>
                    </span>
                  </span>
                </div>
              </button>
              <DropdownMenu
                size="xs"
                square
                hide-chevron
                icon="mdi:dots-horizontal"
                class="row-menu"
                :title="t('common.more')"
                align="right"
                :items="getRowMenuItems(item)"
              />
            </template>
          </li>
        </ul>
      </section>
    </div>

    <div v-if="!dialog.isHistoryEnabled" class="panel-footer">
      <p class="history-disabled-hint">
        {{ t('history.chatsDisabled') }}
      </p>
    </div>

    <ConfirmModal
      :open="Boolean(dialogToDelete)"
      :title="t('dialog.deleteConfirmTitle')"
      :message="t('dialog.deleteConfirmMessage')"
      :confirm-text="t('common.delete')"
      @confirm="confirmDeleteDialog"
      @cancel="dialogToDelete = null"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import { useNow } from '../../composables/use-now'
import useToast from '../../composables/use-toast'
import { exportDialogTranscript } from '../../lib/dialog/dialog-export'
import {
  filterDialogHistory,
  formatDialogDuration,
  formatDialogStartTime,
  groupDialogHistory,
} from '../../lib/dialog/dialog-history-list'
import { formatHistoryDateTime } from '../../lib/history/history-list'
import { clientLogger } from '../../lib/logger'
import { preventMouseFocus } from '../../lib/ui/focus'
import { useDialogStore } from '../../stores/dialog'
import { useDialogHistoryStore } from '../../stores/dialog-history'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SearchInput from '../common/SearchInput.vue'
import StateMessage from '../common/StateMessage.vue'
import type { DialogSummary } from '@tyco/shared'

const MAX_DIALOG_TITLE_LENGTH = 120
const SEARCH_DEBOUNCE_MS = 200

const emit = defineEmits<{ (e: 'navigate'): void }>()

const { t, locale } = useI18n()
const { toastKey } = useToast()
const copyValue = useCopyValue()
const dialog = useDialogStore()
const dialogHistory = useDialogHistoryStore()

void dialogHistory.loadDialogs().catch((error: unknown) => {
  clientLogger.warn(`Could not load dialog history: ${String(error)}`, 'dialog')
  toastKey('history.operationFailed', 'error')
})

const isSearchOpen = ref(false)
const searchInputRef = ref<{ focus(): void } | null>(null)
const query = ref('')
const matchedIds = ref<Set<string> | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0

async function toggleSearch() {
  isSearchOpen.value = !isSearchOpen.value
  if (isSearchOpen.value) {
    await nextTick()
    searchInputRef.value?.focus?.()
  } else {
    query.value = ''
  }
}

function closeSearch() {
  isSearchOpen.value = false
  query.value = ''
}

const listKey = computed(() =>
  dialogHistory.dialogs
    .map((item) => `${item.id}:${item.updatedAt}`)
    .sort()
    .join('\n')
)

watch([query, listKey], ([value], [previousQuery]) => {
  clearTimeout(searchTimer)
  if (value !== previousQuery) matchedIds.value = null
  const run = ++searchRun
  if (!value.trim()) return
  searchTimer = setTimeout(async () => {
    try {
      const ids = await dialogHistory.searchDialogs(value)
      if (run === searchRun) matchedIds.value = new Set(ids)
    } catch (error) {
      clientLogger.warn(`Dialog search failed: ${String(error)}`, 'dialog')
    }
  }, SEARCH_DEBOUNCE_MS)
})

onUnmounted(() => {
  clearTimeout(searchTimer)
})

const now = useNow()
const groups = computed(() =>
  groupDialogHistory(
    filterDialogHistory(dialogHistory.dialogs, query.value, matchedIds.value),
    now.value
  )
)

const removedDialog = computed(() => dialogHistory.removedDialog)
const undoRemove = () => {
  void dialogHistory.undoRemoveDialog()
}

function sourceIcon(item: DialogSummary): string {
  return item.source === 'microphoneAndSystem'
    ? 'mdi:account-multiple-outline'
    : 'mdi:monitor-speaker'
}

function itemLabel(item: DialogSummary): string {
  if (item.title.trim()) return item.title.trim()
  if (item.preview.trim()) return item.preview.trim()
  return item.source === 'microphoneAndSystem'
    ? t('dialog.sourceCall')
    : t('dialog.sourceComputer')
}

function itemTooltip(item: DialogSummary): string {
  if (dialog.isActive) return t('dialog.stopToSwitchHint')
  return itemLabel(item)
}

async function startNewDialog() {
  if (dialog.isActive) return
  await dialog.clear()
  emit('navigate')
}

async function selectDialog(id: string) {
  if (dialog.isActive) return
  try {
    const opened = await dialog.openDialog(id)
    if (!opened) toastKey('dialog.notFound', 'error')
    else emit('navigate')
  } catch (error) {
    clientLogger.warn(`Could not open dialog ${id}: ${String(error)}`, 'dialog')
    toastKey('history.operationFailed', 'error')
  }
}

const dialogToDelete = ref<string | null>(null)

async function confirmDeleteDialog() {
  const id = dialogToDelete.value
  dialogToDelete.value = null
  if (!id) return
  await dialogHistory.removeDialog(id)
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputs = ref<HTMLInputElement[]>([])
let isFinishingRename = false

async function beginRename(item: DialogSummary) {
  renamingId.value = item.id
  renameValue.value = item.title
  await nextTick()
  const input = renameInputs.value[0]
  input?.focus()
  input?.select()
}

function cancelRename() {
  renamingId.value = null
}

async function finishRename(item: DialogSummary) {
  if (isFinishingRename || renamingId.value !== item.id) return
  isFinishingRename = true
  const nextTitle = renameValue.value.trim()
  renamingId.value = null
  try {
    if (nextTitle !== item.title) {
      await dialogHistory.renameDialog(item.id, nextTitle)
    }
  } catch (error) {
    clientLogger.warn(
      `Could not rename dialog ${item.id}: ${String(error)}`,
      'dialog'
    )
    toastKey('history.operationFailed', 'error')
  } finally {
    isFinishingRename = false
  }
}

async function copyDialogTranscript(id: string) {
  try {
    let text: string
    if (dialog.currentDialogId === id) {
      text = dialog.exportText()
    } else {
      const loaded = await dialogHistory.getDialog(id)
      if (!loaded) {
        toastKey('dialog.notFound', 'error')
        return
      }
      text = exportDialogTranscript(
        loaded.segments.map((segment) => ({ ...segment, isFinal: true })),
        {
          includeTranslation: Boolean(loaded.translationTargetLanguage),
          breaks: loaded.sessionBreaks,
          labels: {
            me: t('dialog.sideMe'),
            remote: t('dialog.sideRemote'),
            translation: t('dialog.translationLabel'),
            sessionResumed: t('dialog.sessionResumedListening'),
            sessionResumedRecording: t('dialog.sessionResumedRecording'),
            sessionStartedListening: t('dialog.sessionStartedListening'),
            sessionStartedRecording: t('dialog.sessionStartedRecording'),
            sessionResumedListening: t('dialog.sessionResumedListening'),
          },
        }
      )
    }
    if (await copyValue.copy(text)) toastKey('common.copied', 'info')
  } catch (error) {
    clientLogger.warn(
      `Could not copy dialog transcript ${id}: ${String(error)}`,
      'dialog'
    )
    toastKey('history.operationFailed', 'error')
  }
}

async function sendDialogToActionMenu(id: string) {
  try {
    let text: string
    if (dialog.currentDialogId === id) {
      text = dialog.exportText()
    } else {
      const loaded = await dialogHistory.getDialog(id)
      if (!loaded) {
        toastKey('dialog.notFound', 'error')
        return
      }
      text = exportDialogTranscript(
        loaded.segments.map((segment) => ({ ...segment, isFinal: true })),
        {
          includeTranslation: Boolean(loaded.translationTargetLanguage),
          breaks: loaded.sessionBreaks,
          labels: {
            me: t('dialog.sideMe'),
            remote: t('dialog.sideRemote'),
            translation: t('dialog.translationLabel'),
            sessionResumed: t('dialog.sessionResumedListening'),
            sessionResumedRecording: t('dialog.sessionResumedRecording'),
            sessionStartedListening: t('dialog.sessionStartedListening'),
            sessionStartedRecording: t('dialog.sessionStartedRecording'),
            sessionResumedListening: t('dialog.sessionResumedListening'),
          },
        }
      )
    }
    if (!text) return
    await dialog.sendToActionMenu(text)
  } catch (error) {
    clientLogger.warn(
      `Could not send dialog transcript ${id} to action menu: ${String(error)}`,
      'dialog'
    )
    toastKey('history.operationFailed', 'error')
  }
}

function getRowMenuItems(item: DialogSummary): DropdownMenuItem[] {
  return [
    {
      label: t('dialog.renameDialog'),
      icon: 'mdi:pencil-outline',
      action: () => void beginRename(item),
    },
    {
      label: t('dialog.copy'),
      icon: 'mdi:content-copy',
      action: () => void copyDialogTranscript(item.id),
    },
    {
      label: t('dialog.toActionMenu'),
      icon: 'mdi:lightning-bolt-outline',
      action: () => void sendDialogToActionMenu(item.id),
    },
    ...(item.recordingCount > 0
      ? [
          {
            label: t('dialog.openRecordingsFolder'),
            icon: 'mdi:folder-open-outline',
            action: () => void dialog.openRecordingsFolder(item.id),
          },
        ]
      : []),
    {
      label: t('dialog.deleteDialog'),
      icon: 'mdi:trash-can-outline',
      action: () => {
        dialogToDelete.value = item.id
      },
    },
  ]
}
</script>

<style scoped>
.dialog-history-panel {
  display: flex;
  flex-direction: column;
  width: 17rem;
  min-width: 15rem;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-sunken);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border-bottom: 1px solid var(--app-border-subtle);
}

.panel-notice {
  margin: var(--space-xs) var(--space-sm) 0;
}

.panel-search {
  margin: var(--space-xs) var(--space-sm) 0;
}

.dialog-list-scroll {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-xs) var(--space-sm) var(--space-md);
}

.dialog-list-empty {
  padding-top: var(--space-lg);
}

.dialog-group {
  margin-top: var(--space-sm);
}

.dialog-group:first-child {
  margin-top: var(--space-xs);
}

.dialog-group h2 {
  margin: 0 0 var(--space-2xs);
  padding: 0 var(--space-xs);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--app-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dialog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-list-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-md);
}

.dialog-list-row:hover {
  background-color: var(--app-hover);
}

.dialog-list-item {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-xs);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-base-content);
  text-align: left;
  cursor: pointer;
}

.dialog-list-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dialog-list-item.is-active {
  background-color: var(--app-active);
}

.dialog-item-icon {
  margin-top: 0.125rem;
  color: var(--app-text-muted);
}

.dialog-item-body {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-small);
  line-height: 1.3;
}

.dialog-item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  font-size: var(--text-micro);
  color: var(--app-text-faint);
  font-variant-numeric: tabular-nums;
}

.dialog-item-rec {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  color: var(--app-text-muted);
}

.row-menu {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.dialog-list-row:hover .row-menu,
.dialog-list-row:focus-within .row-menu {
  opacity: 1;
}

.rename-form {
  flex: 1;
  padding: 2px var(--space-xs);
}

.rename-form input {
  width: 100%;
  padding: 2px var(--space-xs);
  font-size: var(--text-small);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-primary);
  background-color: var(--app-surface);
  color: var(--color-base-content);
  outline: none;
}

.panel-footer {
  padding: var(--space-xs) var(--space-sm);
  border-top: 1px solid var(--app-border-subtle);
}

.history-disabled-hint {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--app-text-faint);
}
</style>
