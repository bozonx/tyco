<template>
  <div class="flex flex-col">
    <div class="line-row" v-for="(item, index) in localItems" :key="index">
      <div class="flex-1">
        <slot name="item" :item="item" :index="index" />
      </div>
      <div class="line-controls">
        <div class="flex flex-col">
          <Button
            class="move-btn"
            xs
            :disabled="index === 0"
            neutral
            @click="moveItemUp(index)"
          >
            <Icon icon="mdi:arrow-up" />
          </Button>
          <Button
            class="move-btn"
            xs
            :disabled="index === localItems.length - 1"
            neutral
            @click="moveItemDown(index)"
          >
            <Icon icon="mdi:arrow-down" />
          </Button>
        </div>
        <div>
          <Button neutral square @click="removeItem(index)">
            <Icon icon="mdi:close" height="18" />
          </Button>
        </div>
      </div>
    </div>
    <div class="flex flex-row justify-end gap-2 mt-1">
      <Button @click="addItem">{{ t('common.add') }}</Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  items: Record<string, any>[]
}>()

const emit = defineEmits<{
  (e: 'update:items', items: Record<string, any>[]): void
}>()

const localItems = ref<Record<string, any>[]>([...props.items])
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
  localItems.value.splice(index - 1, 0, localItems.value.splice(index, 1)[0])
  syncItems()
}

const moveItemDown = (index: number) => {
  localItems.value.splice(index + 1, 0, localItems.value.splice(index, 1)[0])
  syncItems()
}
</script>

<style scoped>
.move-btn {
  height: 20px;
}

.line-row {
  display: flex;
  flex-direction: row;
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--app-border-subtle);
  transition: background-color var(--transition-fast);
}

.line-row:last-child {
  border-bottom: none;
}

.line-row:hover {
  background-color: oklch(var(--b2));
}

.line-controls {
  display: none;
  flex-direction: row;
  gap: var(--space-xs);
  align-items: flex-start;
  padding-left: var(--space-sm);
}

.line-row:hover .line-controls {
  display: flex;
}
</style>
