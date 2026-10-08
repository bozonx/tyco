<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="editor-context-menu"
      :style="style"
      role="menu"
      @contextmenu.prevent
      @mousedown.prevent
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
          :class="{
            'is-accent': item.accent,
            'is-open': subIndex === Number(index),
          }"
          :data-index="index"
          :disabled="item.disabled"
          :aria-haspopup="item.children ? 'menu' : undefined"
          :aria-expanded="
            item.children ? subIndex === Number(index) : undefined
          "
          @mouseenter="onItemHover(Number(index))"
          @click="select(item, Number(index))"
        >
          <Icon v-if="item.icon" :icon="item.icon" height="16" />
          <span v-else-if="hasIcons" class="editor-context-menu__icon-gap" />
          <span class="editor-context-menu__label">{{ item.label }}</span>
          <Icon
            v-if="item.children"
            icon="mdi:chevron-right"
            height="16"
            class="editor-context-menu__chevron"
          />
        </button>
      </template>
    </div>

    <div
      v-if="subItems"
      ref="subRef"
      class="editor-context-menu"
      :style="subStyle"
      role="menu"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <template v-for="(item, index) in subItems" :key="item.id">
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
          <span v-else-if="subHasIcons" class="editor-context-menu__icon-gap" />
          <span class="editor-context-menu__label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="editor-context-menu__shortcut">{{
            item.shortcut
          }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import type { EditorMenuItem, MenuPlacement } from '../../lib/editor/menu-item'
import { placeMenu, placeSubmenu } from '../../lib/editor/menu-placement'
import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    /** Viewport coordinates, the way CodeMirror reports them */
    x: number
    y: number
    /** Bottom of the anchored text line; used by `below` */
    bottom?: number
    items: EditorMenuItem[]
    placement?: MenuPlacement
  }>(),
  { placement: 'point' }
)

const emit = defineEmits<{ (e: 'close', restoreFocus: boolean): void }>()

const menuRef = ref<HTMLElement | null>(null)
const subRef = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })
const placed = ref(false)
const subIndex = ref<number | null>(null)
const subPosition = ref({ x: 0, y: 0 })
const subPlaced = ref(false)

const hasIcons = computed(() => props.items.some((item) => item.icon))
const subHasIcons = computed(() =>
  Boolean(subItems.value?.some((item) => item.icon))
)

const subItems = computed(() =>
  subIndex.value === null ? null : props.items[subIndex.value]?.children
)

// the menu has to be measured before it can be placed; showing it at the raw
// anchor for that one frame would make it jump
const style = computed<CSSProperties>(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  visibility: placed.value ? 'visible' : 'hidden',
}))

const subStyle = computed<CSSProperties>(() => ({
  left: `${subPosition.value.x}px`,
  top: `${subPosition.value.y}px`,
  visibility: subPlaced.value ? 'visible' : 'hidden',
}))

const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
})

/** Put the menu next to its anchor, keeping it inside the window */
const place = (): void => {
  const element = menuRef.value

  if (!element) return

  const { width, height } = element.getBoundingClientRect()

  position.value = placeMenu(
    { x: props.x, y: props.y, bottom: props.bottom },
    { width, height },
    props.placement,
    viewport()
  )
  placed.value = true
}

const itemButton = (index: number): HTMLButtonElement | null =>
  menuRef.value?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`) ??
  null

const enabledButtons = (container: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(
    container?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
      []
  )

const openSubmenu = async (
  index: number,
  focusFirst = false
): Promise<void> => {
  if (subIndex.value !== index) {
    subIndex.value = index
    subPlaced.value = false
  }

  await nextTick()

  const parent = itemButton(index)
  const element = subRef.value

  if (!parent || !element) return

  const { width, height } = element.getBoundingClientRect()

  subPosition.value = placeSubmenu(
    parent.getBoundingClientRect(),
    { width, height },
    viewport()
  )
  subPlaced.value = true

  if (focusFirst) enabledButtons(element)[0]?.focus()
}

const closeSubmenu = (focusParent: boolean): void => {
  const index = subIndex.value

  subIndex.value = null

  if (focusParent && index !== null) itemButton(index)?.focus()
}

const onItemHover = (index: number): void => {
  const item = props.items[index]

  if (item?.children && !item.disabled) void openSubmenu(index)
  else if (subIndex.value !== null) closeSubmenu(false)
}

const holdsFocus = (): boolean =>
  Boolean(
    menuRef.value?.contains(document.activeElement) ||
    subRef.value?.contains(document.activeElement)
  )

const close = (): void => emit('close', holdsFocus())

const select = async (item: EditorMenuItem, index?: number): Promise<void> => {
  if (item.disabled) return

  if (item.children) {
    if (index !== undefined) await openSubmenu(index, true)

    return
  }

  close()

  await item.action?.()
}

const onPointerDown = (event: MouseEvent): void => {
  const target = event.target as Node

  if (menuRef.value?.contains(target) || subRef.value?.contains(target)) return

  emit('close', false)
}

const inSubmenu = (): boolean =>
  Boolean(subRef.value?.contains(document.activeElement))

/** Move focus between enabled items of the active panel, wrapping around */
const moveFocus = (delta: number): void => {
  const buttons = enabledButtons(inSubmenu() ? subRef.value : menuRef.value)

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

const focusedIndex = (): number | null => {
  const value = (document.activeElement as HTMLElement | null)?.dataset?.index

  return value === undefined ? null : Number(value)
}

const onKeyDown = (event: KeyboardEvent): void => {
  const handled = (): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  if (event.key === 'Escape') {
    handled()

    if (inSubmenu()) closeSubmenu(true)
    else close()

    return
  }

  // the arrows belong to the editor caret until the menu itself has focus
  if (!holdsFocus()) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      handled()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }

    return
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    handled()
    moveFocus(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'ArrowRight' && !inSubmenu()) {
    const index = focusedIndex()

    if (index !== null && props.items[index]?.children) {
      handled()
      void openSubmenu(index, true)
    }
  } else if (event.key === 'ArrowLeft' && inSubmenu()) {
    handled()
    closeSubmenu(true)
  }
}

watch(
  () => [props.x, props.y, props.bottom, props.placement, props.items],
  () => {
    subIndex.value = null
    void nextTick(place)
  }
)

const onScroll = (event: Event): void => {
  const target = event.target as Node | null

  if (
    target &&
    (menuRef.value?.contains(target) || subRef.value?.contains(target))
  ) {
    return
  }

  close()
}

onMounted(() => {
  place()

  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', close)
  // scrolling the editor moves the menu away from its anchor — simpler to close
  window.addEventListener('scroll', onScroll, true)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', onScroll, true)
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
  max-height: calc(100vh - 1rem);
  padding: var(--space-xs);
  overflow-y: auto;
  overscroll-behavior: contain;
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

.editor-context-menu__item:hover:not(:disabled),
.editor-context-menu__item.is-open {
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

/* keeps labels aligned when some items of the menu have icons */
.editor-context-menu__icon-gap {
  flex-shrink: 0;
  width: 16px;
}

.editor-context-menu__label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.editor-context-menu__shortcut {
  flex-shrink: 0;
  padding-left: 1rem;
  font-size: 0.75rem;
  color: var(--app-text-faint);
}

.editor-context-menu__chevron {
  flex-shrink: 0;
  margin-right: -0.25rem;
  color: var(--app-text-faint);
}

.editor-context-menu__separator {
  height: 1px;
  margin: var(--space-xs) 0;
  background-color: var(--app-border-subtle);
}
</style>
