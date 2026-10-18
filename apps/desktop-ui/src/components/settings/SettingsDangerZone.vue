<template>
  <div class="settings-danger-zone">
    <p class="settings-danger-message">{{ message }}</p>
    <Button
      size="sm"
      variant="danger"
      icon="mdi:trash-can-outline"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import Button from '../common/Button.vue'

defineProps<{ message: string; actionLabel: string }>()
const emit = defineEmits<{ action: [] }>()
</script>

<style scoped>
.settings-danger-zone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-lg);
  border: 1px solid color-mix(in oklab, var(--color-error) 30%, transparent);
  border-radius: var(--radius-md);
  background-color: color-mix(in oklab, var(--color-error) 5%, transparent);
}

.settings-danger-message {
  font-size: var(--text-body);
  color: var(--color-error);
}
</style>
