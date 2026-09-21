<template>
  <div class="field-items flex flex-col gap-2">
    <div ref="listRef" class="flex flex-col gap-2">
      <div
        v-for="(item, index) in localItems"
        :key="item.id || index"
        data-sortable-item
        class="item-card group"
        :class="{
          'is-sorting': isSorting,
          'is-dragged': draggedIndex === index,
        }"
        :style="itemStyle(index)"
      >
        <div
          class="drag-handle"
          :title="t('settings.dragToReorder')"
          @pointerdown="startDrag(index, $event)"
        >
          <Icon icon="mdi:drag-vertical" width="18" height="18" />
        </div>

        <div class="flex-1 min-w-0">
          <slot name="item" :item="item" :index="index" />
        </div>

        <div class="item-controls">
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
import { useSortableList } from '../../composables/useSortableList'
import { moveItem } from '../../lib/sortable/sortable-list'
import Button from './Button.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{ items: Record<string, any>[] }>()

const emit = defineEmits<{
  (e: 'update:items', items: Record<string, any>[]): void
}>()

const localItems = ref<Record<string, any>[]>([...props.items])
const listRef = ref<HTMLElement | null>(null)
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

const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => {
    localItems.value = moveItem(localItems.value, from, to)
    syncItems()
  }
)

const itemStyle = (index: number) => {
  const offset = itemOffset(index)

  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

const addItem = () => {
  localItems.value.push({})
  syncItems()
}

const removeItem = (index: number) => {
  localItems.value.splice(index, 1)
  syncItems()
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

/* Neighbours glide into place only while a drag is in progress, so the
   final reorder lands without animating back from the old offsets. */
.item-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.item-card.is-dragged {
  position: relative;
  z-index: 1;
  border-color: var(--color-primary);
  box-shadow: var(--app-shadow-lg);
  transition: none;
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
  /* Touch and pen drags must not scroll the page instead */
  touch-action: none;
  transition: color var(--transition-fast);
}

.drag-handle:hover {
  color: var(--color-base-content);
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
