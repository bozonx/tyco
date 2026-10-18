<template>
  <div class="settings-detail-header">
    <Button
      size="sm"
      variant="ghost"
      icon="mdi:arrow-left"
      @click="emit('back')"
    >
      {{ backLabel }}
    </Button>
    <div v-if="$slots.default" class="settings-detail-actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from '../common/Button.vue'

defineProps<{ backLabel: string }>()
const emit = defineEmits<{ back: [] }>()
</script>

<style scoped>
.settings-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.settings-detail-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
