<template>
  <div class="flex flex-col w-full h-full">
    <!-- Toolbar above editor -->
    <div class="flex items-center justify-between gap-2 mb-2">
      <!-- Left column: Case and Format dropdowns + plugin left buttons -->
      <div class="flex items-center gap-2">
        <DropdownMenu :label="t('editor.case')" :items="caseDropdownItems" />
        <DropdownMenu
          :label="t('editor.format')"
          :items="formatDropdownItems"
        />
        <Button
          v-for="item in leftToolbarItems"
          :key="item.id"
          sm
          square
          neutral
          :title="getToolbarTooltip(item)"
          @click="item.action"
        >
          <Icon :icon="item.icon" height="20" />
        </Button>
      </div>

      <!-- Right column: plugin right buttons, AI task, Translation & Insert to window icon buttons -->
      <div class="flex items-center gap-2">
        <Button
          v-for="item in rightToolbarItems"
          :key="item.id"
          sm
          square
          neutral
          :title="getToolbarTooltip(item)"
          @click="item.action"
        >
          <Icon :icon="item.icon" height="20" />
        </Button>
        <Button
          sm
          square
          neutral
          @click="handleAiTask"
          :title="t('action.aiTask')"
        >
          <Icon icon="mdi:robot" height="20" />
        </Button>
        <Button
          sm
          square
          neutral
          @click="handleTranslation"
          :title="t('action.translation')"
        >
          <Icon icon="mdi:translate" height="20" />
        </Button>
        <Button
          sm
          square
          neutral
          @click="handleInsertToWindow"
          :title="t('action.insertIntoWindow')"
        >
          <Icon icon="mdi:application-export" height="20" />
        </Button>
      </div>
    </div>

    <!-- Main editor area -->
    <div class="flex-1 flex gap-2 min-w-0">
      <div class="flex-1 min-w-0">
        <EditorInput />
      </div>
      <div class="flex gap-2 flex-col">
        <Button
          sm
          square
          @click="voiceRecognition"
          :title="t('editor.voiceInput')"
        >
          <Icon icon="mdi:microphone" height="24" />
        </Button>
        <Button
          sm
          square
          @click="handleCorrection"
          :title="t('action.correction')"
        >
          <Icon icon="mdi:auto-fix" height="24" />
        </Button>
        <Button
          sm
          square
          @click="handleCopy"
          :title="t('action.copyToClipboard')"
        >
          <Icon icon="mdi:content-copy" height="24" />
        </Button>
        <Button
          sm
          square
          @click="editorInputStore.selectAll"
          :title="t('editor.selectAll')"
        >
          <Icon icon="mdi:select-all" height="24" />
        </Button>
        <Button
          sm
          square
          @click="editorInputStore.clear"
          :title="t('editor.clear')"
        >
          <Icon icon="mdi:clear" height="24" />
        </Button>
      </div>
    </div>

    <div>
      <p class="text-xs mt-1 mb-2 text-muted">
        {{ t('editor.selectionHint') }}
      </p>

      <div
        v-if="otherEditItems.length > 0"
        class="flex gap-1 w-full flex-wrap mb-2"
      >
        <Button
          v-for="item in otherEditItems"
          :key="item.labelKey || item.name"
          sm
          neutral
          :icon="item.icon"
          @click="doEdit(item.action)"
          >{{ getLabel(item) }}</Button
        >
      </div>

      <h2 class="mt-4 mb-1 text-sm">{{ t('editor.actions') }}</h2>
      <div class="flex gap-1 w-full flex-wrap">
        <Button
          v-for="item in bottomActions"
          :key="item.labelKey || item.name"
          :icon="item.icon"
          @click="doAction(item)"
          >{{ getLabel(item) }}</Button
        >
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'

import { useEditorActions } from '../composables/useEditorActions'
import { useI18n } from '../composables/useI18n'
import type { ActionItem } from '../stores/actionMenu'
import { useActionMenuStore } from '../stores/actionMenu'
import type { EditItem } from '../stores/editMenu'
import { useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useHistoryStore } from '../stores/history'
import { useToolbarStore } from '../stores/toolbar'
import type { ToolbarItem } from '../types/plugins'
import DropdownMenu, { type DropdownMenuItem } from './common/DropdownMenu.vue'
import { Icon } from '@iconify/vue'

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const editMenuStore = useEditMenuStore()
const toolbarStore = useToolbarStore()
const historyStore = useHistoryStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()

const caseDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getCaseItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item.action),
    }))
)

const formatDropdownItems = computed<DropdownMenuItem[]>(() =>
  editMenuStore
    .getFormatItems()
    .map((item: EditItem) => ({
      label: getLabel(item),
      icon: item.icon,
      action: () => doEdit(item.action),
    }))
)

const otherEditItems = computed(() => editMenuStore.getOtherEditItems())

const leftToolbarItems = computed(() => toolbarStore.getLeftToolbarItems())
const rightToolbarItems = computed(() => toolbarStore.getRightToolbarItems())

const getToolbarTooltip = (item: ToolbarItem): string => {
  if (item.tooltipKey) {
    return t(item.tooltipKey)
  }
  return item.tooltip || ''
}

const EXCLUDED_ACTION_KEYS = new Set([
  'action.copyToClipboard',
  'action.correction',
  'action.insertIntoWindow',
  'action.translation',
  'action.askInChat',
  'action.aiTask',
])

const bottomActions = computed(() =>
  actionMenuStore
    .getActionsMenu()
    .filter(
      (item: ActionItem) =>
        !item.labelKey || !EXCLUDED_ACTION_KEYS.has(item.labelKey)
    )
)

const handleAiTask = async () => {
  const aiTaskAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.aiTask')
  if (aiTaskAction) {
    await doAction(aiTaskAction)
  }
}

const handleInsertToWindow = async () => {
  const insertAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.insertIntoWindow')
  if (insertAction) {
    await doAction(insertAction)
  }
}

const handleTranslation = async () => {
  const translationAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.translation')
  if (translationAction) {
    await doAction(translationAction)
  }
}

const handleCorrection = async () => {
  const correctionAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.correction')
  if (correctionAction) {
    await doAction(correctionAction)
  }
}

const handleCopy = async () => {
  const copyAction = actionMenuStore
    .getActionsMenu()
    .find((item: ActionItem) => item.labelKey === 'action.copyToClipboard')
  if (copyAction) {
    await doAction(copyAction)
  }
}

onUnmounted(async () => {
  if (editorInputStore.value) {
    historyStore.saveEditorHistory(editorInputStore.value)
  }

  await historyStore.clearMainInputTmp()
})
</script>
