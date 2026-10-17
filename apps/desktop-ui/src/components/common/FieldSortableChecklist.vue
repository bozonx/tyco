<template>
  <fieldset
    v-bind="controlAttrs()"
    class="field-sortable-checklist flex flex-col gap-1.5 w-full"
  >
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
        <DragHandle @drag="startDrag(index, $event)" />

        <FieldCheckbox
          class="checklist-item-label flex-1 min-w-0"
          :model-value="item.enabled"
          :label="getOptionLabel(item.id)"
          @update:model-value="toggleItem(index)"
        />
      </div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import { useI18n } from '../../composables/use-i18n'
import { useSortableList } from '../../composables/use-sortable-list'
import { moveItem } from '../../lib/sortable/sortable-list'
import type { InputConfigOption } from '../../types'
import DragHandle from './DragHandle.vue'
import FieldCheckbox from './FieldCheckbox.vue'
import {
  type SortableChecklistItem,
  resolveSortableChecklist,
} from '@tyco/plugin-sdk'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl({ register: false })
const props = defineProps<{
  modelValue?: unknown

  options?: InputConfigOption[]
  defaultValue?: unknown
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SortableChecklistItem[]]
}>()

const { t } = useI18n()
const listRef = ref<HTMLElement | null>(null)

const localItems = ref<SortableChecklistItem[]>(
  resolveSortableChecklist(
    props.modelValue,
    props.options ?? [],
    props.defaultValue
  )
)

watch(
  () => [props.modelValue, props.options, props.defaultValue],
  () => {
    localItems.value = resolveSortableChecklist(
      props.modelValue,
      props.options ?? [],
      props.defaultValue
    )
  },
  { deep: true }
)

const syncItems = () => {
  emit(
    'update:modelValue',
    localItems.value.map((i: SortableChecklistItem) => ({ ...i }))
  )
}

const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => {
    reorderItem(from, to)
  },
  { getItemKeys: () => localItems.value.map((item) => item.id) }
)

function reorderItem(from: number, to: number) {
  localItems.value = moveItem(localItems.value, from, to)
  syncItems()
}

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
</style>
