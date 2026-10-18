<template>
  <div class="editor-rail">
    <template v-if="compact">
      <IconButton
        size="sm"
        variant="danger-ghost"
        @click="editorInputStore.clear"
        :label="t('editor.clear')"
        icon="mdi:eraser"
      />
    </template>
    <template v-else>
      <IconButton
        size="sm"
        variant="ghost"
        tone="accent"
        @click="emit('voice-recognition')"
        :label="t('editor.voiceInput')"
        icon="mdi:microphone-outline"
      />
      <IconButton
        size="sm"
        variant="ghost"
        tone="accent"
        @click="emit('correction')"
        :label="scoped(t('action.correction'))"
        icon="mdi:auto-fix"
      />
      <div class="rail-divider" />
      <IconButton
        size="sm"
        variant="ghost"
        @click="emit('copy')"
        :label="scoped(t('action.copy'))"
        icon="mdi:content-copy"
      />
      <IconButton
        size="sm"
        variant="ghost"
        @click="editorInputStore.requestSelectAll"
        :label="t('editor.selectAll')"
        icon="mdi:select-all"
      />
      <IconButton
        size="sm"
        variant="danger-ghost"
        @click="editorInputStore.clear"
        :label="t('editor.clear')"
        icon="mdi:eraser"
      />
      <div class="rail-divider" />
      <InfoTooltip
        :text="t('editor.selectionHint')"
        align="end"
        placement="bottom"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { scopedActionLabel } from '../../lib/editor/editor-toolbar-item'
import { useEditorInputStore } from '../../stores/editor-input'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'

defineProps<{ compact?: boolean }>()

const emit = defineEmits<{
  'voice-recognition': []
  correction: []
  copy: []
}>()

const editorInputStore = useEditorInputStore()
const { t } = useI18n()

const scoped = (label: string) =>
  scopedActionLabel(label, editorInputStore.hasSelection, t)
</script>

<style scoped>
.editor-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.375rem;
  border-left: 1px solid var(--app-border-subtle);
}

.rail-divider {
  width: 1.25rem;
  height: 1px;
  margin: 0.25rem 0;
  background-color: var(--app-border);
}
</style>
