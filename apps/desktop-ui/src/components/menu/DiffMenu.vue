<template>
  <ActionOverlayLayout
    :title="
      t(props.replaceEditor ? 'editor.conflict.title' : 'menu.compareResult')
    "
    esc-mode="auto"
  >
    <template #header-extra>
      <Button
        v-if="draftText !== props.newText"
        size="xs"
        variant="ghost"
        @click="draftText = props.newText"
        >{{ t('diff.resetResult') }}</Button
      >
      <ResultViewModeToggle preset="diff" v-model="diffMode" />
    </template>

    <template #preview>
      <Diff
        :old-text="props.oldText"
        v-model:new-text="draftText"
        editable
        :mode="diffMode"
      />
    </template>

    <template #actions>
      <ShortcutList
        editor-shortcut
        :text="draftText"
        :source-text="props.oldText"
        :left-letter-keys="props.replaceEditor ? [] : leftLetterKeys"
        :space-key="props.replaceEditor ? replaceEditorAction : spaceKey"
        :is-editor-button-visible="!props.replaceEditor && !isEditorTarget"
        esc-mode="auto"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePersistedDiffMode } from '../../composables/use-persisted-view-mode'
import { useResultActions } from '../../composables/use-result-actions'
import { useViewModeArrowKeys } from '../../composables/use-view-mode-arrow-keys'
import type { DiffMenuParams } from '../../lib/modals/menu-modal-params'
import Button from '../common/Button.vue'
import Diff from '../common/Diff.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import ResultViewModeToggle from './ResultViewModeToggle.vue'
import type { ActionItem } from '@tyco/plugin-sdk'

const props = defineProps<DiffMenuParams>()
const { t } = useI18n()
const draftText = ref(props.newText)
watch(
  () => props.newText,
  (value) => {
    draftText.value = value
  }
)
const replaceEditorAction = computed<ActionItem>(() => ({
  id: 'replaceEditor',
  labelKey: 'editor.conflict.replace',
  icon: 'mdi:pencil-outline',
  action: async () => props.replaceEditor?.(draftText.value),
}))

const { diffMode, stepMode } = usePersistedDiffMode()

useViewModeArrowKeys(stepMode)

const { leftLetterKeys, spaceKey, isEditorTarget } = useResultActions(
  () => props.oldText
)
</script>
