<template>
  <ActionOverlayLayout
    :title="
      t(props.replaceEditor ? 'editor.conflict.title' : 'menu.compareResult')
    "
    esc-mode="back"
  >
    <template #header-extra>
      <ResultViewModeToggle preset="diff" v-model="diffMode" />
    </template>

    <template #preview>
      <Diff
        :old-text="props.oldText"
        :new-text="props.newText"
        :mode="diffMode"
      />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.newText"
        :source-text="props.oldText"
        :left-letter-keys="props.replaceEditor ? [] : leftLetterKeys"
        :space-key="props.replaceEditor ? replaceEditorAction : spaceKey"
        :is-editor-button-visible="!props.replaceEditor"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePersistedDiffMode } from '../../composables/use-persisted-view-mode'
import { usePreviewModeShortcut } from '../../composables/use-preview-mode-shortcut'
import { useResultActions } from '../../composables/use-result-actions'
import type { DiffMenuParams } from '../../lib/modals/menu-modal-params'
import Diff from '../common/Diff.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import ResultViewModeToggle from './ResultViewModeToggle.vue'
import type { ActionItem } from '@tyco/plugin-sdk'

const props = defineProps<DiffMenuParams>()
const { t } = useI18n()
const replaceEditorAction = computed<ActionItem>(() => ({
  id: 'replaceEditor',
  labelKey: 'editor.conflict.replace',
  icon: 'mdi:pencil-outline',
  action: async () => props.replaceEditor?.(),
}))

const { diffMode, cycleMode } = usePersistedDiffMode()

usePreviewModeShortcut(cycleMode)

const { leftLetterKeys, spaceKey } = useResultActions()
</script>
