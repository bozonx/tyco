<template>
  <div class="field-items flex flex-col gap-2">
    <div
      v-for="(item, index) in localItems"
      :key="item.id || index"
      class="item-card group"
      :class="{
        'is-dragged': draggedIndex === index,
        'is-drop-target': dragOverIndex === index && draggedIndex !== index,
      }"
      @dragover.prevent="handleDragOver(index)"
      @dragenter.prevent="handleDragEnter(index)"
      @dragleave="handleDragLeave(index)"
      @drop.prevent="handleDrop(index)"
    >
      <!-- Drag Handle -->
      <div
        class="drag-handle"
        draggable="true"
        :title="t('settings.dragToReorder')"
        @dragstart="handleDragStart(index, $event)"
        @dragend="handleDragEnd"
      >
        <Icon icon="mdi:drag-vertical" width="18" height="18" />
      </div>

      <!-- Item Content Slot -->
      <div class="flex-1 min-w-0">
        <slot name="item" :item="item" :index="index" />
      </div>

      <!-- Controls: Up / Down / Remove -->
      <div class="item-controls">
        <div class="flex items-center">
          <Button
            class="control-btn"
            xs
            ghost
            square
            :disabled="index === 0"
            :title="t('settings.moveUp')"
            @click="moveItemUp(index)"
          >
            <Icon icon="mdi:arrow-up" width="15" height="15" />
          </Button>
          <Button
            class="control-btn"
            xs
            ghost
            square
            :disabled="index === localItems.length - 1"
            :title="t('settings.moveDown')"
            @click="moveItemDown(index)"
          >
            <Icon icon="mdi:arrow-down" width="15" height="15" />
          </Button>
        </div>
        <Button
          class="delete-btn"
          xs
          ghost
          square
          :title="t('common.delete')"
          @click="removeItem(index)"
        >
          <Icon icon="mdi:trash-can-outline" width="16" height="16" />
        </Button>
      </div>
    </div>

    <Button class="add-btn" sm ghost @click="addItem">
      <Icon icon="mdi:plus" width="16" height="16" />
      {{ t('common.add') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import Button from './Button.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{ items: Record<string, any>[] }>()

const emit = defineEmits<{
  (e: 'update:items', items: Record<string, any>[]): void
}>()

const localItems = ref<Record<string, any>[]>([...props.items])
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const { t } = useI18n()

watch(
  () => props.items,
  (newItems) => {
    localItems.value = [...newItems]
  },
  { deep: true }
)

const syncItems = () => {
  emit('update:items', [...localItems.value])
}

const addItem = () => {
  localItems.value.push({})
  syncItems()
}

const removeItem = (index: number) => {
  localItems.value.splice(index, 1)
  syncItems()
}

const moveItemUp = (index: number) => {
  if (index <= 0) return
  const item = localItems.value.splice(index, 1)[0]
  localItems.value.splice(index - 1, 0, item)
  syncItems()
}

const moveItemDown = (index: number) => {
  if (index >= localItems.value.length - 1) return
  const item = localItems.value.splice(index, 1)[0]
  localItems.value.splice(index + 1, 0, item)
  syncItems()
}

const handleDragStart = (index: number, event: DragEvent) => {
  draggedIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

const handleDragOver = (index: number) => {
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    dragOverIndex.value = index
  }
}

const handleDragEnter = (index: number) => {
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    dragOverIndex.value = index
  }
}

const handleDragLeave = (index: number) => {
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null
  }
}

const handleDrop = (targetIndex: number) => {
  const sourceIndex = draggedIndex.value
  draggedIndex.value = null
  dragOverIndex.value = null

  if (sourceIndex === null || sourceIndex === targetIndex) {
    return
  }

  const [movedItem] = localItems.value.splice(sourceIndex, 1)
  localItems.value.splice(targetIndex, 0, movedItem)
  syncItems()
}

const handleDragEnd = () => {
  draggedIndex.value = null
  dragOverIndex.value = null
}
</script>

<style scoped>
.item-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-sm) var(--space-md) var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    opacity var(--transition-fast);
}

.item-card:hover {
  border-color: var(--app-border-strong);
}

.item-card.is-dragged {
  opacity: 0.5;
  border-style: dashed;
  border-color: var(--color-primary);
}

.item-card.is-drop-target {
  border-color: var(--color-primary);
  box-shadow: var(--app-focus-ring);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-faint);
  cursor: grab;
  transition: color var(--transition-fast);
}

.drag-handle:hover {
  color: var(--color-base-content);
}

.drag-handle:active {
  cursor: grabbing;
}

.item-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 2.25rem;
  flex-shrink: 0;
  opacity: 0.55;
  transition: opacity var(--transition-fast);
}

.item-card:hover .item-controls,
.item-card:focus-within .item-controls {
  opacity: 1;
}

.control-btn,
.delete-btn {
  color: var(--app-text-muted);
}

.delete-btn:hover {
  color: var(--color-error);
}

.add-btn {
  justify-content: center;
  width: 100%;
  border: 1px dashed var(--app-border-strong);
  color: var(--app-text-muted);
}

.add-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
</style>
