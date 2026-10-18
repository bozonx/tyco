<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    class="shortcut-hint"
    :disabled="interactive ? disabled : undefined"
    @mousedown="preserveFocus"
    @click="emit('click', $event)"
  >
    <KeyboardKey v-for="key in keys" :key="key">{{ key }}</KeyboardKey>
    <span v-if="$slots.default"><slot /></span>
  </component>
</template>
<script setup lang="ts">
import KeyboardKey from '../common/KeyboardKey.vue'

withDefaults(
  defineProps<{ keys: string[]; interactive?: boolean; disabled?: boolean }>(),
  { interactive: false, disabled: false }
)
const emit = defineEmits<{ click: [event: MouseEvent] }>()
function preserveFocus(event: MouseEvent) {
  event.preventDefault()
}
</script>
<style scoped>
.shortcut-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.125rem 0.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: var(--text-control);
}
button.shortcut-hint {
  cursor: pointer;
}
button.shortcut-hint:hover:not(:disabled) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}
button.shortcut-hint:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
