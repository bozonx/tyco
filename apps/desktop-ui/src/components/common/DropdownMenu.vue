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
      :tone="tone"
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

    <Teleport to="body" :disabled="!canTeleport">
      <MenuSurface
        v-if="isOpen"
        ref="surfaceRef"
        :style="panelStyle"
        :data-theme="panelTheme"
        @focusout="onFocusout"
        class="dropdown-panel min-w-44 max-w-80 max-h-72 overflow-y-auto"
        :id="menuId"
        role="menu"
        :aria-label="label ?? title ?? translate('common.more')"
        @keydown="onMenuKeydown"
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
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watchEffect } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { usePopover } from '../../composables/use-popover'
import { translate } from '../../lib/i18n'
import type {
  ButtonTone,
  ButtonVariant,
  ControlSize,
} from '../../lib/ui/control-types'
import { focusAfterTrigger } from '../../lib/ui/focus-navigation'
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

const props = withDefaults(
  defineProps<{
    tone?: ButtonTone
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
const {
  isOpen,
  containerRef,
  triggerRef,
  panelRef,
  close,
  onFocusout,
  onEscape,
} = usePopover()

const surfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
watchEffect(() => {
  panelRef.value = surfaceRef.value?.element ?? null
})
const canTeleport = computed(() => !containerRef.value?.closest('dialog'))
const {
  style: panelStyle,
  theme: panelTheme,
  updatePosition,
} = useAnchoredPanel({
  isOpen: () => isOpen.value,
  anchor: () => containerRef.value?.querySelector('button') ?? null,
  panel: () => panelRef.value,
  placement: () => props.placement ?? 'bottom',
  align: () => (props.align === 'right' ? 'end' : 'start'),
})

async function openAndFocus(index: number) {
  isOpen.value = true
  await nextTick()
  panelRef.value = surfaceRef.value?.element ?? null
  updatePosition()
  await nextTick()
  const items = menuButtons(panelRef.value)
  items[index]?.focus()
}
function toggleMenu() {
  if (isOpen.value) close(true)
  else void openAndFocus(0)
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    const trigger = containerRef.value?.querySelector('button')
    if (event.shiftKey) close(true)
    else {
      if (trigger) focusAfterTrigger(trigger, panelRef.value)
      close()
    }
    return
  }
  if (focusMenuItem(panelRef.value, event.key)) {
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
.dropdown-panel {
  max-width: min(20rem, calc(100vw - 1rem));
  max-height: min(18rem, calc(100dvh - 1rem));
}
</style>
