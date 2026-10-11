<template>
  <div class="template-field">
    <textarea
      v-if="multiline"
      ref="fieldRef"
      class="textarea template-field-control"
      rows="3"
      :value="value"
      :placeholder="placeholder"
      spellcheck="false"
      @input="emitValue"
    />
    <input
      v-else
      ref="fieldRef"
      class="input template-field-control"
      :value="value"
      :placeholder="placeholder"
      spellcheck="false"
      @input="emitValue"
    />
    <!-- mousedown.prevent: the field keeps its focus and caret -->
    <Button
      type="button"
      ghost
      square
      sm
      :title="t('settings.actionInsertText', { placeholder: TEXT })"
      @mousedown.prevent
      @click="insert(TEXT)"
    >
      <Icon icon="mdi:code-braces" width="18" height="18" />
    </Button>
    <slot />
    <InfoTooltip v-if="info" :text="info" align="end" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import Button from '../common/Button.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import { Icon } from '@iconify/vue'
import { ACTION_TEXT_PLACEHOLDER as TEXT } from '@tyco/shared'

const props = defineProps<{
  value?: string
  placeholder?: string
  info?: string
  multiline?: boolean
}>()

const emit = defineEmits<{ (e: 'update:value', value: string): void }>()

const { t } = useI18n()
const fieldRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

function emitValue(event: Event) {
  emit('update:value', (event.target as HTMLInputElement).value)
}

/** Puts `snippet` in place of the selection, or at the end without focus. */
async function insert(snippet: string) {
  const el = fieldRef.value
  const value = props.value ?? ''
  const focused = el !== null && document.activeElement === el
  const start = focused ? (el.selectionStart ?? value.length) : value.length
  const end = focused ? (el.selectionEnd ?? start) : value.length
  emit('update:value', value.slice(0, start) + snippet + value.slice(end))
  await nextTick()
  el?.focus()
  el?.setSelectionRange(start + snippet.length, start + snippet.length)
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

.template-field > :deep(.info-tooltip-container) {
  align-self: center;
}

.template-field-control {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.8125rem;
}

textarea.template-field-control {
  min-height: 4.5rem;
  resize: vertical;
}
</style>
