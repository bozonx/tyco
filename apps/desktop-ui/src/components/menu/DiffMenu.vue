<template>
  <ActionOverlayLayout :title="t('menu.compareResult')" escMode="back">
    <template #header-extra>
      <DiffModeToggle v-model:value="diffMode" />
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
import { ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePreviewModeShortcut } from '../../composables/use-preview-mode-shortcut'
import { useResultActions } from '../../composables/use-result-actions'
import { type DiffViewMode, resolveDiffMode } from '../../lib/diff/diff-model'
import type { DiffMenuParams } from '../../lib/modals/menu-modal-params'
import { useIpcStore } from '../../stores/ipc'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Diff from '../common/Diff.vue'
import DiffModeToggle from '../common/DiffModeToggle.vue'

const props = defineProps<DiffMenuParams>()
const ipcStore = useIpcStore()
const { t } = useI18n()

const diffMode = ref<DiffViewMode>(
  resolveDiffMode(ipcStore.desktopState.localState?.diffMode)
)

watch(diffMode, (newMode) => {
  void ipcStore.patchLocalState({ diffMode: newMode })
})

function cycleMode() {
  const modes: DiffViewMode[] = ['unified', 'split', 'result']
  const nextIdx = (modes.indexOf(diffMode.value) + 1) % modes.length
  diffMode.value = modes[nextIdx]
}

usePreviewModeShortcut(cycleMode)

const { leftLetterKeys, spaceKey } = useResultActions()
</script>
