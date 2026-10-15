<template>
  <Teleport to="body">
    <MenuSurface
      ref="menuSurfaceRef"
      class="editor-context-menu"
      :style="style"
      role="menu"
      @focusout="onFocusout"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <template v-for="(item, index) in items" :key="item.id">
        <div
          v-if="item.separatorBefore && Number(index) > 0"
          class="editor-context-menu__separator"
          role="separator"
        />
        <MenuItem
          class="editor-context-menu__item"
          :label="item.label"
          :icon="item.icon"
          :reserve-icon="hasIcons"
          :accent="item.accent"
          :active="subIndex === Number(index)"
          :disabled="item.disabled"
          :has-submenu="Boolean(item.children)"
          :shortcut="item.shortcut"
          :data-index="index"
          :aria-haspopup="item.children ? 'menu' : undefined"
          :aria-expanded="
            item.children ? subIndex === Number(index) : undefined
          "
          @mouseenter="onItemHover(Number(index))"
          @click="select(item, Number(index))"
        />
      </template>
    </MenuSurface>

    <MenuSurface
      v-if="subItems"
      ref="subSurfaceRef"
      class="editor-context-menu"
      :style="subStyle"
      role="menu"
      @focusout="onFocusout"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <template v-for="(item, index) in subItems" :key="item.id">
        <div
          v-if="item.separatorBefore && Number(index) > 0"
          class="editor-context-menu__separator"
          role="separator"
        />
        <MenuItem
          class="editor-context-menu__item"
          :label="item.label"
          :icon="item.icon"
          :reserve-icon="subHasIcons"
          :accent="item.accent"
          :disabled="item.disabled"
          :shortcut="item.shortcut"
          @click="select(item)"
        />
      </template>
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import type { EditorMenuItem, MenuPlacement } from '../../lib/editor/menu-item'
import { placeMenu, placeSubmenu } from '../../lib/editor/menu-placement'
import { focusMenuItem, menuButtons } from '../../lib/ui/menu-navigation'
import MenuItem from '../common/MenuItem.vue'
import MenuSurface from '../common/MenuSurface.vue'

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

const menuSurfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const subSurfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const menuRef = computed(() => menuSurfaceRef.value?.element ?? null)
const subRef = computed(() => subSurfaceRef.value?.element ?? null)
const position = ref({ x: props.x, y: props.y })
const isPlaced = ref(false)
const subIndex = ref<number | null>(null)
const subPosition = ref({ x: 0, y: 0 })
const isSubPlaced = ref(false)

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
  visibility: isPlaced.value ? 'visible' : 'hidden',
}))

const subStyle = computed<CSSProperties>(() => ({
  left: `${subPosition.value.x}px`,
  top: `${subPosition.value.y}px`,
  visibility: isSubPlaced.value ? 'visible' : 'hidden',
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
  isPlaced.value = true
}

const itemButton = (index: number): HTMLButtonElement | null =>
  menuRef.value?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`) ??
  null

const openSubmenu = async (
  index: number,
  focusFirst = false
): Promise<void> => {
  if (subIndex.value !== index) {
    subIndex.value = index
    isSubPlaced.value = false
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
  isSubPlaced.value = true

  if (focusFirst) {
    await nextTick()
    menuButtons(element)[0]?.focus()
  }
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

const inSubmenu = (): boolean =>
  Boolean(subRef.value?.contains(document.activeElement))

async function onFocusout() {
  await nextTick()
  if (!holdsFocus()) emit('close', false)
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

  if (event.key === 'Tab' && holdsFocus()) {
    // Restore the editor before the browser computes its next Tab stop.
    emit('close', true)
    return
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
      focusMenuItem(inSubmenu() ? subRef.value : menuRef.value, event.key)
    }

    return
  }

  if (focusMenuItem(inSubmenu() ? subRef.value : menuRef.value, event.key)) {
    handled()
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

useDismissibleLayer({
  isOpen: () => true,
  elements: () => [menuRef.value, subRef.value],
  dismiss: () => emit('close', false),
  keydown: onKeyDown,
  outsideEvent: 'mousedown',
})

onMounted(() => {
  place()

  window.addEventListener('resize', close)
  // scrolling the editor moves the menu away from its anchor — simpler to close
  window.addEventListener('scroll', onScroll, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<style scoped>
.editor-context-menu {
  position: fixed;
  z-index: var(--z-modal);
  min-width: 11rem;
  max-width: 20rem;
  max-height: calc(100vh - 1rem);
}
.editor-context-menu__separator {
  height: 1px;
  margin: var(--space-xs) 0;
  background-color: var(--app-border-subtle);
}
</style>
