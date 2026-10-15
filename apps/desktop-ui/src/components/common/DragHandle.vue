<template>
  <IconButton
    class="drag-handle"
    :label="t('settings.dragToReorder')"
    icon="mdi:drag-vertical"
    @pointerdown="emit('drag', $event)"
  />
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import IconButton from './IconButton.vue'

const emit = defineEmits<{ drag: [event: PointerEvent] }>()
const { t } = useI18n()
</script>
<style scoped>
.drag-handle {
  flex-shrink: 0;
  color: var(--app-text-faint);
  cursor: grab;
  touch-action: none;
  opacity: 0.6;
}
.drag-handle:hover,
.drag-handle:focus-visible {
  color: var(--color-base-content);
  opacity: 1;
}
.drag-handle:active {
  cursor: grabbing;
}
</style>
