<template>
  <div
    class="field-prompt-container"
    :class="$attrs.class"
    :style="$attrs.style as any"
  >
    <FieldTextArea
      ref="fieldRef"
      v-bind="forwardAttrs"
      :class="$attrs.class"
      :appearance="appearance"
      :size="size"
      :model-value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :auto-resize="autoResize"
      :max-auto-height="maxAutoHeight"
      @update:model-value="emit('update:modelValue', $event)"
      @select="handleSelect"
    />
    <div v-if="!disabled" class="field-prompt-actions">
      <CopyButton
        v-if="modelValue"
        class="field-prompt-copy-btn"
        variant="ghost"
        size="xs"
        :value="modelValue"
        :label="t('common.copy')"
      />
      <IconButton
        class="field-prompt-expand-btn"
        variant="ghost"
        size="xs"
        icon="mdi:arrow-expand"
        :label="t('common.expandInEditor')"
        :title="t('common.expandInEditor')"
        @click="openModal"
      />
    </div>

    <FullTextEditorDialog
      :open="isModalOpen"
      :title="dialogTitle"
      :placeholder="placeholder"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      @close="closeModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useAttrs } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ControlSize } from '../../lib/ui/control-types'
import CopyButton from './CopyButton.vue'
import FieldTextArea from './FieldTextArea.vue'
import FullTextEditorDialog from './FullTextEditorDialog.vue'
import IconButton from './IconButton.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  appearance?: 'default' | 'plain'
  size?: ControlSize
  modelValue?: string
  placeholder?: string
  rows?: number
  autoResize?: boolean
  maxAutoHeight?: number
  disabled?: boolean
  modalTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select', value: string, start: number, end: number): void
}>()

const { t } = useI18n()
const attrs = useAttrs()

const forwardAttrs = computed(() => {
  const { class: _, style: __, ...rest } = attrs
  return rest
})

const fieldRef = ref<InstanceType<typeof FieldTextArea> | null>(null)
const isModalOpen = ref(false)

const dialogTitle = computed(
  () => props.modalTitle || props.placeholder || t('common.editorModalTitle')
)

function openModal() {
  if (props.disabled) return
  isModalOpen.value = true
}

async function closeModal() {
  isModalOpen.value = false
  await nextTick()
  fieldRef.value?.focus()
}

function handleSelect(value: string, start: number, end: number) {
  emit('select', value, start, end)
}

defineExpose({
  focus: () => fieldRef.value?.focus(),
  isFocused: () => fieldRef.value?.isFocused?.() ?? false,
  getSelection: () => fieldRef.value?.getSelection?.() ?? null,
  select: (start?: number, end?: number) =>
    fieldRef.value?.select?.(start, end),
})
</script>

<style scoped>
.field-prompt-container {
  position: relative;
  display: block;
  width: 100%;
}

.field-prompt-actions {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast, 120ms);
  z-index: 2;
}

.field-prompt-container:hover .field-prompt-actions,
.field-prompt-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.field-prompt-modal {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  gap: var(--space-md);
  box-sizing: border-box;
}

.field-prompt-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--app-border);
}

.field-prompt-modal-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-weight: 600;
  color: var(--color-base-content);
  font-size: var(--text-body);
}

.field-prompt-modal-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.field-prompt-modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.field-prompt-modal-textarea {
  width: 100%;
  height: 100%;
  flex: 1;
  resize: none;
  font-family: var(--font-mono);
  font-size: var(--text-body);
  line-height: 1.6;
  tab-size: 2;
  padding: var(--space-md);
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  overscroll-behavior: contain;
}

.field-prompt-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.field-prompt-modal-stats {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.field-prompt-modal-stats-divider {
  opacity: 0.5;
}
</style>
