<template>
  <div ref="listRef" class="shortcut-slots">
    <div
      v-for="(key, index) in SHORTCUT_SLOT_KEYS"
      :key="key"
      data-sortable-item
      class="shortcut-slot"
      :class="{
        'is-empty': !items[index],
        'is-stacked': stacked,
        'is-dragged': draggedIndex === index,
        'is-drop-target': targetIndex === index,
      }"
    >
      <div class="slot-lead">
        <KeyboardKey>{{ key }}</KeyboardKey>
        <DragHandle v-if="items[index]" @drag="startDrag(index, $event)" />
      </div>

      <template v-if="items[index]">
        <div class="slot-content">
          <slot name="item" :item="items[index]" :index="index" />
        </div>
        <IconButton
          class="delete-btn"
          size="xs"
          variant="ghost"
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
        <AppIcon icon="mdi:plus" size="md" />
        {{ t('common.add') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSortableList } from '../../composables/use-sortable-list'
import { SHORTCUT_SLOT_KEYS } from '../../types'
import AppIcon from '../common/AppIcon.vue'
import DragHandle from '../common/DragHandle.vue'
import IconButton from '../common/IconButton.vue'
import KeyboardKey from '../common/KeyboardKey.vue'

const props = defineProps<{
  items: readonly (T | null | undefined)[]
  /** Pin the key to the top with the drag handle under it (multi-field items). */
  stacked?: boolean
}>()

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

.slot-lead {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-sm);
}

.shortcut-slot.is-stacked {
  align-items: flex-start;
}

.is-stacked .slot-lead {
  flex-direction: column;
  gap: var(--space-xs);
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
