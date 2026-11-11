<template>
  <span v-if="keys.length" class="shortcut-keys">
    <template v-for="(key, index) in keys" :key="`${index}-${key}`">
      <span v-if="index" class="shortcut-separator" aria-hidden="true">{{
        MODIFIERS.has(keys[index - 1]!) ? '+' : ','
      }}</span>
      <KeyboardKey>{{ key }}</KeyboardKey>
    </template>
  </span>
</template>

<script setup lang="ts">
import KeyboardKey from '../common/KeyboardKey.vue'

defineProps<{ keys: string[] }>()
const MODIFIERS = new Set(['Shift', 'Ctrl', 'Alt', 'Meta', 'Cmd', 'Super'])
</script>

<style scoped>
.shortcut-keys {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0.2rem;
  white-space: nowrap;
}
.shortcut-separator {
  color: var(--app-text-muted);
}
</style>
