<template>
  <div
    ref="containerRef"
    class="relative inline-block text-left"
    @focusout="onFocusout"
    @keydown.esc="onEscape"
  >
    <button
      ref="triggerRef"
      type="button"
      class="btn btn-ghost dropdown-trigger flex items-center gap-1"
      :class="{
        'btn-xs': xs,
        'btn-sm': !xs,
        'btn-active': isOpen,
        'btn-square': square,
      }"
      :title="title"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :aria-controls="isOpen ? menuId : undefined"
      :aria-label="label ?? title ?? translate('common.more')"
      @keydown.down.stop.prevent="openAndFocus(0)"
      @keydown.up.stop.prevent="openAndFocus(items.length - 1)"
      @click="toggleMenu"
    >
      <Icon v-if="icon" :icon="icon" height="16" />
      <span v-if="label" class="truncate max-w-44 sm:max-w-64">{{
        label
      }}</span>
      <Icon
        v-if="!hideChevron"
        icon="mdi:chevron-down"
        height="16"
        class="opacity-70 transition-transform duration-150 shrink-0"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <div
      v-if="isOpen"
      class="dropdown-panel absolute min-w-44 max-w-80 max-h-72 overflow-y-auto"
      :id="menuId"
      role="menu"
      :aria-label="label ?? title ?? translate('common.more')"
      @keydown="onMenuKeydown"
      :class="[
        placement === 'top' ? 'bottom-full top-auto mb-1' : 'top-full mt-1',
        align === 'right' ? 'right-0 left-auto' : 'left-0',
      ]"
    >
      <button
        v-for="(item, idx) in items"
        :key="idx"
        type="button"
        class="dropdown-item"
        role="menuitem"
        tabindex="-1"
        :class="{ 'is-danger': item.danger }"
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
import { nextTick, useId } from 'vue'

import { usePopover } from '../../composables/use-popover'
import { translate } from '../../lib/i18n'
import { Icon } from '@iconify/vue'

export interface DropdownMenuItem {
  label: string
  icon?: string
  danger?: boolean
  action: () => void | Promise<void>
}

defineProps<{
  label?: string
  icon?: string
  title?: string
  xs?: boolean
  square?: boolean
  hideChevron?: boolean
  placement?: 'bottom' | 'top'
  align?: 'left' | 'right'
  items: DropdownMenuItem[]
}>()

const menuId = useId()
const { isOpen, containerRef, triggerRef, close, onFocusout, onEscape } =
  usePopover()

async function openAndFocus(index: number) {
  isOpen.value = true
  await nextTick()
  const items =
    containerRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  items?.[index]?.focus()
}
function toggleMenu() {
  if (isOpen.value) close(true)
  else void openAndFocus(0)
}
function onMenuKeydown(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const items = [
    ...(containerRef.value?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]'
    ) ?? []),
  ]
  if (!items.length) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
          items.length
  items[index].focus()
}
const selectItem = async (item: DropdownMenuItem) => {
  close(true)
  await item.action()
}
</script>

<style scoped>
.dropdown-trigger {
  font-weight: 500;
}

.dropdown-panel {
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  padding: var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-lg);
  overflow-x: hidden;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.375rem var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-control);
  text-align: left;
  color: var(--color-base-content);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.dropdown-item:hover,
.dropdown-item:focus-visible {
  background-color: var(--app-hover);
}

.dropdown-item.is-danger {
  color: var(--color-error);
}

.dropdown-item.is-danger:hover,
.dropdown-item.is-danger:focus-visible {
  background-color: var(--color-error);
  color: var(--color-error-content);
}
</style>
