<template>
  <div class="field-sortable-checklist flex flex-col gap-1.5 w-full">
    <div ref="listRef" class="flex flex-col gap-1.5 w-full">
      <div
        v-for="(item, index) in localItems"
        :key="item.id"
        data-sortable-item
        class="checklist-item-card group"
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

        <label
          class="checklist-item-label flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer py-1.5 pr-2.5 select-none"
        >
          <input
            type="checkbox"
            :checked="item.enabled"
            class="checkbox checkbox-primary checkbox-sm shrink-0"
            @change="toggleItem(index)"
          />
          <span
            class="text-sm truncate"
            :class="{ 'opacity-60': !item.enabled }"
          >
            {{ getOptionLabel(item.id) }}
          </span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useSortableList } from '../../composables/useSortableList'
import {
  resolveSortableChecklist,
  type SortableChecklistItem,
} from '../../lib/plugins/sortable-checklist'
import { moveItem } from '../../lib/sortable/sortable-list'
import type { InputConfigOption } from '../../types'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  value?: unknown
  options?: InputConfigOption[]
  defaultValue?: unknown
}>()

const emit = defineEmits<{
  (e: 'update:value', value: SortableChecklistItem[]): void
}>()

const { t } = useI18n()
const listRef = ref<HTMLElement | null>(null)

const localItems = ref<SortableChecklistItem[]>(
  resolveSortableChecklist(props.value, props.options ?? [], props.defaultValue)
)

watch(
  () => [props.value, props.options, props.defaultValue],
  () => {
    localItems.value = resolveSortableChecklist(
      props.value,
      props.options ?? [],
      props.defaultValue
    )
  },
  { deep: true }
)

const syncItems = () => {
  emit(
    'update:value',
    localItems.value.map((i) => ({ ...i }))
  )
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

const toggleItem = (index: number) => {
  if (!localItems.value[index]) return
  localItems.value[index].enabled = !localItems.value[index].enabled
  syncItems()
}

const getOptionLabel = (id: string): string => {
  const opt = props.options?.find((o) => String(o.id) === id)
  if (!opt) return id
  if (opt.labelKey) return t(opt.labelKey)
  return opt.name || id
}
</script>

<style scoped>
.checklist-item-card {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 var(--space-xs);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    opacity var(--transition-fast);
}

.checklist-item-card:hover {
  border-color: var(--app-border-strong);
}

.checklist-item-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.checklist-item-card.is-dragged {
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
  width: 1.5rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  cursor: grab;
  touch-action: none;
  opacity: 0.6;
  transition:
    color var(--transition-fast),
    opacity var(--transition-fast);
}

.drag-handle:hover,
.checklist-item-card:hover .drag-handle,
.checklist-item-card.is-sorting .drag-handle,
.checklist-item-card.is-dragged .drag-handle {
  color: var(--color-base-content);
  opacity: 1;
}
</style>
