<template>
  <div class="shortcut-slots">
    <div
      v-for="(key, index) in SHORTCUT_SLOT_KEYS"
      :key="key"
      class="shortcut-slot"
      :class="{
        'is-empty': !items[index],
        'is-dragged': draggedIndex === index,
        'is-drop-target': dropIndex === index,
      }"
      @dragover.prevent="dropIndex = index"
      @dragleave="clearDropTarget(index)"
      @drop.prevent="drop(index)"
    >
      <KeyButton>{{ key }}</KeyButton>

      <template v-if="items[index]">
        <IconButton
          class="drag-handle"
          draggable="true"
          :title="t('settings.dragToReorder')"
          @dragstart="startDrag(index, $event)"
          @dragend="finishDrag"
          :label="t('settings.dragToReorder')"
          icon="mdi:drag-vertical"
        />
        <div class="slot-content">
          <slot name="item" :item="items[index]" :index="index" />
        </div>
        <IconButton
          class="delete-btn"
          size="xs"
          variant="ghost"
          :title="t('common.delete')"
          @click="$emit('remove', index)"
          :label="t('common.delete')"
          icon="mdi:trash-can-outline"
        />
      </template>

      <button
        v-else
        type="button"
        class="empty-slot"
        :title="t('common.add')"
        @click="$emit('add', index)"
      >
        <Icon icon="mdi:plus" width="16" height="16" />
        {{ t('common.add') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import KeyButton from './KeyButton.vue'
import { Icon } from '@iconify/vue'

defineProps<{ items: readonly (T | null | undefined)[] }>()

const emit = defineEmits<{
  (event: 'move', from: number, to: number): void
  (event: 'add', index: number): void
  (event: 'remove', index: number): void
}>()

const { t } = useI18n()
const draggedIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function startDrag(index: number, event: DragEvent) {
  draggedIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function drop(index: number) {
  if (draggedIndex.value !== null) emit('move', draggedIndex.value, index)
  finishDrag()
}

function clearDropTarget(index: number) {
  if (dropIndex.value === index) dropIndex.value = null
}

function finishDrag() {
  draggedIndex.value = null
  dropIndex.value = null
}
</script>

<style scoped>
.shortcut-slots {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.shortcut-slot {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 3.9rem;
  padding: var(--space-sm);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: var(--app-surface);
  transition:
    border-color var(--transition-fast),
    opacity var(--transition-fast);
}

.shortcut-slot.is-empty {
  border-style: dashed;
  background: transparent;
}

.shortcut-slot.is-drop-target {
  border-color: var(--color-primary);
}

.shortcut-slot.is-dragged {
  opacity: 0.45;
}

.drag-handle {
  display: grid;
  place-items: center;
  width: 1.5rem;
  align-self: stretch;
  border: 0;
  background: transparent;
  color: var(--app-text-faint);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.slot-content {
  flex: 1;
  min-width: 0;
}

.empty-slot {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  align-self: stretch;
  border: 0;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
}

.empty-slot:hover {
  color: var(--color-base-content);
}
</style>
