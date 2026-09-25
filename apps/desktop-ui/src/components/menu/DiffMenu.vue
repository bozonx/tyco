<template>
  <ActionOverlayLayout :title="t('menu.compareResult')">
    <template #header-extra>
      <DiffModeToggle v-model="diffMode" />
    </template>

    <template #preview>
      <Diff
        :oldText="props.oldText"
        :newText="props.newText"
        :mode="diffMode"
      />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.newText"
        :sourceText="props.oldText"
        :leftLetterKeys="leftLetterKeys"
        :spaceKey="spaceKey"
        :toEditorVisible="true"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  type DiffViewMode,
  readStoredDiffMode,
  writeStoredDiffMode,
} from '../../lib/diff/diff-model'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
import DiffModeToggle from '../common/DiffModeToggle.vue'

const props = defineProps<{ oldText: string; newText: string }>()

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const { t } = useI18n()
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const diffMode = ref<DiffViewMode>(readStoredDiffMode())

watch(diffMode, (newMode) => {
  writeStoredDiffMode(newMode)
})

function cycleMode() {
  const modes: DiffViewMode[] = ['unified', 'split', 'result']
  const nextIdx = (modes.indexOf(diffMode.value) + 1) % modes.length
  diffMode.value = modes[nextIdx]
}

function handleKeyDown(event: KeyboardEvent) {
  if (
    event.key.toLowerCase() === 'd' &&
    (event.ctrlKey || event.altKey) &&
    !event.shiftKey
  ) {
    event.preventDefault()
    cycleMode()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() => {
  return actionMenuStore.getShortcutActions()
})

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
)
</script>
