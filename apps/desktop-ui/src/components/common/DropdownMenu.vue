<template>
  <div ref="containerRef" class="relative inline-block text-left">
    <button
      type="button"
      class="btn btn-sm btn-neutral flex items-center gap-1 font-normal"
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
      class="absolute left-0 top-full mt-1 min-w-44 max-w-64 py-1 bg-base-200 border border-base-300 rounded-box shadow-xl z-50 overflow-hidden"
    >
      <button
        v-for="(item, idx) in items"
        :key="idx"
        type="button"
        class="w-full text-left px-3 py-1.5 text-xs text-base-content hover:bg-base-300 flex items-center gap-2 transition-colors cursor-pointer"
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
