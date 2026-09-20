<template>
  <div class="flex flex-col w-full h-full">
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
          @click="editorInputStore.clear"
          :title="t('editor.clear')"
        >
          <Icon icon="mdi:clear" height="24" />
        </Button>
        <Button
          sm
          square
          @click="editorInputStore.selectAll"
          :title="t('editor.selectAll')"
        >
          <Icon icon="mdi:select-all" height="24" />
        </Button>
      </div>
    </div>

    <div>
      <p class="text-xs mt-1 mb-2 text-muted">
        {{ t('editor.selectionHint') }}
      </p>

      <div class="flex gap-1 w-full flex-wrap">
        <Button
          v-for="item in editMenuStore.getEditMenu()"
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
          v-for="item in actionMenuStore.getActionsMenu()"
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
import { onUnmounted } from 'vue'

import { useEditorActions } from '../composables/useEditorActions'
import { useI18n } from '../composables/useI18n'
import { useActionMenuStore } from '../stores/actionMenu'
import { useEditMenuStore } from '../stores/edditMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useHistoryStore } from '../stores/history'
import { Icon } from '@iconify/vue'

const actionMenuStore = useActionMenuStore()
const editorInputStore = useEditorInputStore()
const editMenuStore = useEditMenuStore()
const historyStore = useHistoryStore()
const { t } = useI18n()
const { getLabel, voiceRecognition, doAction, doEdit } = useEditorActions()

onUnmounted(async () => {
  if (editorInputStore.value) {
    historyStore.saveEditorHistory(editorInputStore.value)
  }

  await historyStore.clearMainInputTmp()
})
</script>
