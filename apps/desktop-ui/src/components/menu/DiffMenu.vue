<template>
  <ActionOverlayLayout
    :title="
      t(props.replaceEditor ? 'editor.conflict.title' : 'menu.compareResult')
    "
    escMode="back"
  >
    <template #header-extra>
      <ResultViewModeToggle preset="diff" v-model="diffMode" />
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
        :leftLetterKeys="props.replaceEditor ? [] : leftLetterKeys"
        :spaceKey="props.replaceEditor ? replaceEditorAction : spaceKey"
        :isEditorButtonVisible="!props.replaceEditor"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePreviewModeShortcut } from '../../composables/use-preview-mode-shortcut'
import { useResultActions } from '../../composables/use-result-actions'
import { type DiffViewMode, resolveDiffMode } from '../../lib/diff/diff-model'
import type { DiffMenuParams } from '../../lib/modals/menu-modal-params'
import { useIpcStore } from '../../stores/ipc'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
import ResultViewModeToggle from '../common/ResultViewModeToggle.vue'
import type { ActionItem } from '@tyco/plugin-sdk'

const props = defineProps<DiffMenuParams>()
const ipcStore = useIpcStore()
const { t } = useI18n()
const replaceEditorAction = computed<ActionItem>(() => ({
  id: 'replaceEditor',
  labelKey: 'editor.conflict.replace',
  icon: 'mdi:pencil-outline',
  action: async () => props.replaceEditor?.(),
}))

const diffMode = ref<DiffViewMode>(
  resolveDiffMode(ipcStore.desktopState.userConfig.diffViewMode)
)

watch(diffMode, (newMode) => {
  void ipcStore.saveUserConfig({
    ...ipcStore.desktopState.userConfig,
    diffViewMode: newMode,
  })
})

function cycleMode() {
  const modes: DiffViewMode[] = ['unified', 'split', 'result']
  const nextIdx = (modes.indexOf(diffMode.value) + 1) % modes.length
  diffMode.value = modes[nextIdx]
}

usePreviewModeShortcut(cycleMode)

const { leftLetterKeys, spaceKey } = useResultActions()
</script>
