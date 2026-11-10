<template>
  <BaseDialog
    v-if="open"
    :open="open"
    size="full"
    :label="title"
    @close="emit('close')"
  >
    <div class="full-editor-modal field-prompt-modal">
      <header class="full-editor-header field-prompt-modal-header">
        <div class="full-editor-title field-prompt-modal-title">
          <AppIcon :icon="icon" size="md" aria-hidden="true" />
          <span>{{ title }}</span>
        </div>
        <div class="full-editor-actions field-prompt-modal-actions">
          <slot name="actions">
            <CopyButton
              v-if="modelValue"
              :value="modelValue"
              :label="t('common.copied')"
            />
            <Button size="sm" variant="primary" @click="emit('close')">
              {{ t('common.done') }}
            </Button>
          </slot>
        </div>
      </header>

      <div class="full-editor-body field-prompt-modal-body">
        <textarea
          ref="textareaRef"
          autofocus
          class="full-editor-textarea field-prompt-modal-textarea textarea"
          :placeholder="placeholder"
          :readonly="readonly"
          :value="modelValue ?? ''"
          @input="
            emit(
              'update:modelValue',
              ($event.target as HTMLTextAreaElement).value
            )
          "
        />
      </div>

      <footer class="full-editor-footer field-prompt-modal-footer">
        <slot name="footer">
          <div class="full-editor-stats field-prompt-modal-stats">
            <span>{{ t('common.linesCount', { count: lines }) }}</span>
            <span class="full-editor-stats-divider">•</span>
            <span>{{ t('common.charsCount', { count: chars }) }}</span>
          </div>
        </slot>
      </footer>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from './AppIcon.vue'
import BaseDialog from './BaseDialog.vue'
import Button from './Button.vue'
import CopyButton from './CopyButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    modelValue: string | null | undefined
    placeholder?: string
    icon?: string
    readonly?: boolean
    lineCount?: number
    charCount?: number
  }>(),
  {
    icon: 'mdi:pencil-outline',
    readonly: false,
    placeholder: undefined,
    lineCount: undefined,
    charCount: undefined,
  }
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; close: [] }>()

const { t } = useI18n()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const lines = computed(() => {
  if (props.lineCount !== undefined) return props.lineCount
  if (!props.modelValue) return 0
  return props.modelValue.split('\n').length
})

const chars = computed(() => {
  if (props.charCount !== undefined) return props.charCount
  return props.modelValue?.length ?? 0
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void nextTick(() => {
        textareaRef.value?.focus()
      })
    }
  }
)
</script>

<style scoped>
.full-editor-modal {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  gap: var(--space-md);
  box-sizing: border-box;
}

.full-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--app-border);
}

.full-editor-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-weight: 600;
  color: var(--color-base-content);
  font-size: var(--text-body);
}

.full-editor-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.full-editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.full-editor-textarea {
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

.full-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.full-editor-stats {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.full-editor-stats-divider {
  opacity: 0.5;
}
</style>
