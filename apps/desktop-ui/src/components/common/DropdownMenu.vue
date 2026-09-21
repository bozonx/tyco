<template>
  <div ref="containerRef" class="relative inline-block text-left">
    <button
      type="button"
      class="btn btn-sm btn-ghost dropdown-trigger flex items-center gap-1"
      :class="{ 'btn-active': isOpen }"
      :title="title"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <Icon v-if="icon" :icon="icon" height="16" />
      <span>{{ label }}</span>
      <Icon
        icon="mdi:chevron-down"
        height="16"
        class="opacity-70 transition-transform duration-150"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <div
      v-if="isOpen"
      class="dropdown-panel absolute left-0 top-full mt-1 min-w-44 max-w-64 z-50"
    >
      <button
        v-for="(item, idx) in items"
        :key="idx"
        type="button"
        class="dropdown-item"
        @click="selectItem(item)"
      >
        <Icon
          v-if="item.icon"
          :icon="item.icon"
          height="16"
          class="shrink-0 opacity-70"
        />
        <span class="truncate">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { Icon } from '@iconify/vue'

export interface DropdownMenuItem {
  label: string
  icon?: string
  action: () => void | Promise<void>
}

defineProps<{
  label: string
  icon?: string
  title?: string
  items: DropdownMenuItem[]
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const toggle = () => {
  isOpen.value = !isOpen.value
}

const close = () => {
  isOpen.value = false
}

const selectItem = async (item: DropdownMenuItem) => {
  close()
  await item.action()
}

const onDocumentClick = (event: MouseEvent) => {
  if (
    isOpen.value &&
    containerRef.value &&
    !containerRef.value.contains(event.target as Node)
  ) {
    close()
  }
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.dropdown-trigger {
  font-weight: 500;
}

.dropdown-panel {
  display: flex;
  flex-direction: column;
  padding: var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-lg);
  overflow: hidden;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.375rem var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  text-align: left;
  color: var(--color-base-content);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.dropdown-item:hover,
.dropdown-item:focus-visible {
  background-color: var(--app-hover);
  outline: none;
}
</style>
