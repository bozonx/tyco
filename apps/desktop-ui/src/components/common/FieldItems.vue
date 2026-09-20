<template>
  <div class="field-items flex flex-col gap-2.5">
    <div
      v-for="(item, index) in localItems"
      :key="item.id || index"
      class="item-card group flex items-start gap-3 p-3 rounded-xl border border-base-300 bg-base-100/60 hover:bg-base-100 transition-all duration-150"
      :class="{
        'opacity-50 border-dashed border-primary': draggedIndex === index,
        'ring-2 ring-primary/40 bg-base-200/60':
          dragOverIndex === index && draggedIndex !== index,
      }"
      @dragover.prevent="handleDragOver(index)"
      @dragenter.prevent="handleDragEnter(index)"
      @dragleave="handleDragLeave(index)"
      @drop.prevent="handleDrop(index)"
    >
      <!-- Drag Handle -->
      <div
        class="drag-handle flex items-center justify-center p-1 mt-0.5 rounded cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content/80 hover:bg-base-200 transition-colors select-none"
        draggable="true"
        :title="t('settings.dragToReorder') || 'Drag to reorder'"
        @dragstart="handleDragStart(index, $event)"
        @dragend="handleDragEnd"
      >
        <Icon icon="mdi:drag-vertical" width="20" height="20" />
      </div>

      <!-- Item Content Slot -->
      <div class="flex-1 min-w-0">
        <slot name="item" :item="item" :index="index" />
      </div>

      <!-- Controls: Up / Down / Remove -->
      <div class="flex items-center gap-1 shrink-0 mt-0.5">
        <div class="flex flex-col gap-0.5">
          <Button
            class="control-btn"
            xs
            neutral
            square
            :disabled="index === 0"
            :title="t('settings.moveUp') || 'Move up'"
            @click="moveItemUp(index)"
          >
            <Icon icon="mdi:arrow-up" width="14" height="14" />
          </Button>
          <Button
            class="control-btn"
            xs
            neutral
            square
            :disabled="index === localItems.length - 1"
            :title="t('settings.moveDown') || 'Move down'"
            @click="moveItemDown(index)"
          >
            <Icon icon="mdi:arrow-down" width="14" height="14" />
          </Button>
        </div>
        <Button
          class="delete-btn"
          sm
          neutral
          square
          :title="t('common.delete') || 'Delete'"
          @click="removeItem(index)"
        >
          <Icon icon="mdi:close" width="16" height="16" />
        </Button>
      </div>
    </div>

    <div class="flex flex-row justify-end gap-2 mt-1">
      <Button sm @click="addItem">
        <Icon icon="mdi:plus" width="16" height="16" />
        {{ t('common.add') }}
      </Button>
    </div>
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
.control-btn {
  height: 18px;
  min-height: 18px;
  width: 22px;
  min-width: 22px;
  padding: 0;
}

.delete-btn {
  height: 38px;
  min-height: 38px;
  width: 32px;
  min-width: 32px;
  padding: 0;
}

.item-card {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
</style>
