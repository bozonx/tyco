<template>
  <div :class="$attrs.class" :style="$attrs.style" class="template-field">
    <FieldTextArea
      v-bind="fieldAttrs()"
      v-if="multiline"
      ref="fieldRef"
      class="textarea template-field-control"
      :rows="3"
      :model-value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <FieldInput
      v-bind="fieldAttrs()"
      v-else
      ref="fieldRef"
      class="input template-field-control"
      :model-value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <!-- mousedown.prevent: the field keeps its focus and caret -->
    <IconButton
      variant="ghost"
      size="sm"
      @mousedown.prevent
      @click="insert(TEXT)"
      :label="t('settings.actionInsertText', { placeholder: TEXT })"
      icon="mdi:code-braces"
    />
    <slot />
    <InfoTooltip
      v-if="info"
      class="template-field-info"
      :text="info"
      align="end"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, useAttrs } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { TextControl } from '../../lib/ui/text-control'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import { ACTION_TEXT_PLACEHOLDER as TEXT } from '@tyco/shared'

defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const fieldAttrs = () =>
  Object.fromEntries(
    Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style')
  )
const props = defineProps<{
  modelValue?: string
  placeholder?: string
  info?: string
  multiline?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const { t } = useI18n()
const fieldRef = ref<TextControl | null>(null)

/** Puts `snippet` in place of the selection, or at the end without focus. */
async function insert(snippet: string) {
  const el = fieldRef.value
  const value = props.modelValue ?? ''
  const focused = el?.isFocused() ?? false
  const start = focused
    ? (el?.getSelection()?.start ?? value.length)
    : value.length
  const end = focused ? (el?.getSelection()?.end ?? start) : value.length
  emit('update:modelValue', value.slice(0, start) + snippet + value.slice(end))
  await nextTick()
  el?.focus()
  el?.select(start + snippet.length, start + snippet.length)
}

defineExpose({ insert })
</script>

<style scoped>
.template-field {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs, 0.25rem);
  width: 100%;
}

.template-field-info {
  align-self: center;
}

.template-field-control {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-control);
}

textarea.template-field-control {
  min-height: 4.5rem;
  resize: vertical;
}
</style>
