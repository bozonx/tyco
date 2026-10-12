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
      <textarea
        v-if="editable"
        class="column-textarea"
        :value="rightText"
        :aria-label="rightTitle || t('diff.modified')"
        :placeholder="t('diff.modified')"
        @input="handleInput"
      />
      <div v-else class="column-text readonly-text selectable">
        {{ rightText }}
      </div>
    </template>
  </SplitPanePreview>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
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
function handleInput(event: Event) {
  emit('update:rightText', (event.target as HTMLTextAreaElement).value)
}
</script>
<style scoped>
.column-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
}

.column-textarea {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-base-content);
  font-family: var(--font-sans);
  font-size: 0.9375rem;
  line-height: 1.6;
  padding: var(--space-sm) var(--space-md);
  box-sizing: border-box;
  resize: none;
}

.column-textarea:focus {
  outline: none;
}

.readonly-text {
  padding: var(--space-sm) var(--space-md);
}
</style>
