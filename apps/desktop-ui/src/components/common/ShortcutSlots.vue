<template>
  <div ref="listRef" class="shortcut-slots">
    <div
      v-for="(key, index) in SHORTCUT_SLOT_KEYS"
      :key="key"
      data-sortable-item
      class="shortcut-slot"
      :class="{
        'is-empty': !items[index],
        'is-dragged': draggedIndex === index,
        'is-drop-target': targetIndex === index,
      }"
    >
      <KeyboardKey>{{ key }}</KeyboardKey>

      <template v-if="items[index]">
        <IconButton
          class="drag-handle"
          :title="t('settings.dragToReorder')"
          @pointerdown="startDrag(index, $event)"
          :label="t('settings.dragToReorder')"
          icon="mdi:drag-vertical"
        />
        <ReorderControls
          :name="String(key)"
          :can-move-up="index > 0"
          :can-move-down="index < SHORTCUT_SLOT_KEYS.length - 1"
          @move="moveSlot(index, index + $event, $event)"
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
import { nextTick, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSortableList } from '../../composables/use-sortable-list'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import KeyboardKey from './KeyboardKey.vue'
import ReorderControls from './ReorderControls.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{ items: readonly (T | null | undefined)[] }>()

const emit = defineEmits<{
  (event: 'move', from: number, to: number): void
  (event: 'add', index: number): void
  (event: 'remove', index: number): void
}>()

const { t } = useI18n()
const listRef = ref<HTMLElement | null>(null)
const { draggedIndex, targetIndex, startDrag } = useSortableList(
  listRef,
  (from, to) => emit('move', from, to),
  { mode: 'swap', getItemKeys: () => props.items }
)
async function moveSlot(from: number, to: number, direction: number) {
  emit('move', from, to)
  await nextTick()
  const slot = listRef.value?.querySelectorAll<HTMLElement>(
    '[data-sortable-item]'
  )[to]
  slot
    ?.querySelectorAll<HTMLButtonElement>('[aria-disabled]')
    [direction < 0 ? 0 : 1]?.focus()
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
  touch-action: none;
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
