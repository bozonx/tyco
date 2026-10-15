<template>
  <div
    ref="containerRef"
    class="relative inline-block text-left"
    @focusout="onFocusout"
    @keydown.esc="onEscape"
  >
    <Button
      ref="triggerRef"
      type="button"
      class="dropdown-trigger flex items-center gap-1"
      :size="size"
      :variant="variant"
      :active="isOpen"
      :square="square"
      :class="{ 'dropdown-trigger--muted': muted }"
      :style="{ maxWidth: maxTriggerWidth }"
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
    </Button>

    <MenuSurface
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
      <MenuItem
        v-for="(item, index) in items"
        :key="index"
        class="dropdown-item"
        :label="item.label"
        :icon="item.icon"
        :danger="item.danger"
        @click="selectItem(item)"
      />
    </MenuSurface>
  </div>
</template>

<script setup lang="ts">
import { nextTick, useId } from 'vue'

import { usePopover } from '../../composables/use-popover'
import { translate } from '../../lib/i18n'
import type { ButtonVariant, ControlSize } from '../../lib/ui/control-types'
import { focusMenuItem, menuButtons } from '../../lib/ui/menu-navigation'
import Icon from './AppIcon.vue'
import Button from './Button.vue'
import MenuItem from './MenuItem.vue'
import MenuSurface from './MenuSurface.vue'

export interface DropdownMenuItem {
  label: string
  icon?: string
  danger?: boolean
  action: () => void | Promise<void>
}

withDefaults(
  defineProps<{
    muted?: boolean
    maxTriggerWidth?: string
    label?: string
    icon?: string
    title?: string
    size?: ControlSize
    variant?: ButtonVariant
    square?: boolean
    hideChevron?: boolean
    placement?: 'bottom' | 'top'
    align?: 'left' | 'right'
    items: DropdownMenuItem[]
  }>(),
  { size: 'sm', variant: 'ghost' }
)

const menuId = useId()
const { isOpen, containerRef, triggerRef, close, onFocusout, onEscape } =
  usePopover()

async function openAndFocus(index: number) {
  isOpen.value = true
  await nextTick()
  const items = menuButtons(containerRef.value)
  items[index]?.focus()
}
function toggleMenu() {
  if (isOpen.value) close(true)
  else void openAndFocus(0)
}
function onMenuKeydown(event: KeyboardEvent) {
  if (focusMenuItem(containerRef.value, event.key)) {
    event.preventDefault()
    event.stopPropagation()
  }
}
const selectItem = async (item: DropdownMenuItem) => {
  close(true)
  await item.action()
}
</script>

<style scoped>
.dropdown-trigger--muted {
  color: var(--app-text-muted);
}
</style>
