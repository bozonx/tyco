<template>
  <ActionOverlayLayout
    :title="task.name || t('menu.aiTask')"
    esc-mode="close"
    :on-esc="() => emit('close')"
  >
    <template #preview>
      <div class="ai-task-result-content">
        <InlineNotice
          v-if="wasFocusGuardTriggered"
          kind="info"
          :message="t('selection.noTarget')"
          class="mb-2"
        />
        <InlineNotice
          v-if="wasInsertFailed"
          kind="error"
          :message="t('toast.insertFailed')"
          class="mb-2"
        />
        <TextPreview :text="resultText" />
      </div>
    </template>

    <template #actions>
      <ShortcutList
        :text="resultText"
        :source-text="sourceText"
        :left-letter-keys="leftLetterKeys"
        :space-key="spaceKey"
        :is-editor-button-visible="!isEditorTarget"
        esc-mode="close"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useResultActions } from '../../composables/use-result-actions'
import InlineNotice from '../common/InlineNotice.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import type { AiTaskConfig } from '@tyco/shared'

const props = defineProps<{
  task: AiTaskConfig
  resultText: string
  sourceText?: string
  wasFocusGuardTriggered?: boolean
  wasInsertFailed?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { leftLetterKeys, spaceKey, isEditorTarget } = useResultActions(
  () => props.sourceText
)
</script>

<style scoped>
.ai-task-result-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
</style>
