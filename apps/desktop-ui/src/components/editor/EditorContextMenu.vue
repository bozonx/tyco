<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="editor-context-menu"
      :style="style"
      role="menu"
      @contextmenu.prevent
    >
      <template v-for="(item, index) in items" :key="item.id">
        <div
          v-if="item.separatorBefore && Number(index) > 0"
          class="editor-context-menu__separator"
          role="separator"
        />
        <button
          type="button"
          role="menuitem"
          class="editor-context-menu__item"
          :class="{ 'is-accent': item.accent }"
          :disabled="item.disabled"
          @click="select(item)"
        >
          <Icon v-if="item.icon" :icon="item.icon" height="16" />
          <span class="editor-context-menu__label">{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { EditorMenuItem, MenuPlacement } from '../../lib/editor/menu-item'
import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    /** Viewport coordinates, the way CodeMirror reports them */
    x: number
    y: number
    /** Bottom of the anchored text line; used by `above` / `below` */
    bottom?: number
    items: EditorMenuItem[]
    placement?: MenuPlacement
    /**
     * Arrow-key navigation. Off for the bubble menu: it is open for as long as
     * there is a selection, and the arrows must keep moving the caret
     */
    keyboardNav?: boolean
  }>(),
  { placement: 'point', keyboardNav: false }
)

const emit = defineEmits<{ (e: 'close', restoreFocus: boolean): void }>()

/** Gap from the window edge, so the menu does not stick to the border */
const VIEWPORT_GAP = 8
/** Gap between the menu and the text line it is anchored to */
const ANCHOR_GAP = 6

const menuRef = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })
const placed = ref(false)

const style = computed<CSSProperties>(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  // the menu has to be measured before it can be placed; showing it at the raw
  // anchor for that one frame would make it jump
  visibility: placed.value ? 'visible' : 'hidden',
}))

/** Put the menu next to its anchor, keeping it inside the window */
const place = (): void => {
  const element = menuRef.value

  if (!element) return

  const { width, height } = element.getBoundingClientRect()
  const bottom = props.bottom ?? props.y
  const above = props.y - height - ANCHOR_GAP

  let y = props.y

  if (props.placement === 'above') {
    y = above >= VIEWPORT_GAP ? above : bottom + ANCHOR_GAP
  } else if (props.placement === 'below') {
    y = bottom + ANCHOR_GAP
  }

  position.value = {
    x: Math.max(
      VIEWPORT_GAP,
      Math.min(props.x, window.innerWidth - width - VIEWPORT_GAP)
    ),
    y: Math.max(
      VIEWPORT_GAP,
      Math.min(y, window.innerHeight - height - VIEWPORT_GAP)
    ),
  }
  placed.value = true
}

const holdsFocus = (): boolean =>
  Boolean(menuRef.value?.contains(document.activeElement))

const close = (): void => emit('close', holdsFocus())

const select = async (item: EditorMenuItem): Promise<void> => {
  if (item.disabled) return

  close()

  await item.action()
}

const onPointerDown = (event: MouseEvent): void => {
  if (menuRef.value?.contains(event.target as Node)) return

  emit('close', false)
}

/** Move focus between enabled items, wrapping around */
const moveFocus = (delta: number): void => {
  const buttons = Array.from(
    menuRef.value?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)'
    ) ?? []
  )

  if (buttons.length === 0) return

  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    current === -1
      ? delta > 0
        ? 0
        : buttons.length - 1
      : (current + delta + buttons.length) % buttons.length

  buttons[next].focus()
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()

    return
  }

  if (!props.keyboardNav) return

  const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0

  if (delta === 0) return

  event.preventDefault()
  event.stopPropagation()
  moveFocus(delta)
}

// the bubble menu follows a growing selection without being recreated
watch(
  () => [props.x, props.y, props.bottom, props.placement, props.items.length],
  () => place()
)

onMounted(() => {
  place()

  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', close)
  // scrolling the editor moves the menu away from its anchor — simpler to close
  window.addEventListener('scroll', close, true)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', close, true)
})
</script>

<style scoped>
.editor-context-menu {
  position: fixed;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  min-width: 11rem;
  max-width: 20rem;
  max-height: 60vh;
  padding: var(--space-xs);
  overflow-y: auto;
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
}

.editor-context-menu__item {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  padding: 0.375rem var(--space-sm);
  font-size: 0.8125rem;
  color: var(--color-base-content);
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.editor-context-menu__item:hover:not(:disabled) {
  background-color: var(--app-hover);
}

.editor-context-menu__item:focus-visible {
  background-color: var(--app-hover);
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.editor-context-menu__item:disabled {
  color: var(--app-text-faint);
  cursor: default;
}

.editor-context-menu__item.is-accent {
  font-weight: 600;
}

.editor-context-menu__label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.editor-context-menu__separator {
  height: 1px;
  margin: var(--space-xs) 0;
  background-color: var(--app-border-subtle);
}
</style>
