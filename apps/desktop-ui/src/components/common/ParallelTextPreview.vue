<template>
  <SplitPanePreview
    :left-title="leftTitle || t('diff.original')"
    :right-title="rightTitle || t('diff.modified')"
    flush-right
  >
    <template #left
      ><div class="column-text selectable">{{ leftText }}</div></template
    >
    <template #right>
      <ResultTextEditor
        v-if="editable"
        :model-value="rightText"
        :label="rightTitle || t('diff.modified')"
        @update:model-value="emit('update:rightText', $event)"
      />
      <div v-else class="column-text readonly-text selectable">
        {{ rightText }}
      </div>
    </template>
  </SplitPanePreview>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import ResultTextEditor from './ResultTextEditor.vue'
import SplitPanePreview from './SplitPanePreview.vue'

withDefaults(
  defineProps<{
    leftText: string
    rightText: string
    leftTitle?: string
    rightTitle?: string
    editable?: boolean
  }>(),
  { editable: true }
)
const emit = defineEmits<{ (e: 'update:rightText', value: string): void }>()
const { t } = useI18n()
</script>
<style scoped>
.column-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
}

.readonly-text {
  padding: var(--space-sm) var(--space-md);
}
</style>
