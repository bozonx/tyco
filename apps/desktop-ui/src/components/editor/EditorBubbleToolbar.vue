<template>
  <Teleport to="body">
    <div
      ref="toolbarRef"
      class="editor-bubble-toolbar"
      :style="style"
      role="toolbar"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <template v-for="(item, index) in items" :key="item.id">
        <div
          v-if="item.separatorBefore && Number(index) > 0"
          class="editor-bubble-toolbar__separator"
          role="separator"
        />
        <button
          type="button"
          class="editor-bubble-toolbar__button"
          :class="{ 'has-children': item.children }"
          :title="item.label"
          :aria-label="item.label"
          :aria-haspopup="item.children ? 'menu' : undefined"
          :disabled="item.disabled"
          @click="select(item, $event)"
        >
          <Icon v-if="item.icon" :icon="item.icon" height="18" />
          <Icon
            v-if="item.children"
            icon="mdi:menu-down"
            height="14"
            class="editor-bubble-toolbar__caret"
          />
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import type { EditorMenuItem } from '../../lib/editor/menu-item'
import type { Rect } from '../../lib/editor/menu-placement'
import { placeMenu } from '../../lib/editor/menu-placement'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  /** Top of the first selected line, in viewport coordinates */
  x: number
  y: number
  /** Bottom of the same line: the fallback when there is no room above */
  bottom: number
  items: EditorMenuItem[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** A button with nested items was clicked: show them as a dropdown */
  (e: 'open-group', item: EditorMenuItem, anchor: Rect): void
}>()

const toolbarRef = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })
const placed = ref(false)

const style = computed<CSSProperties>(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  visibility: placed.value ? 'visible' : 'hidden',
}))

/** Above the selection, so the toolbar never covers the text it acts on */
const place = (): void => {
  const element = toolbarRef.value

  if (!element) return

  const { width, height } = element.getBoundingClientRect()

  position.value = placeMenu(
    { x: props.x, y: props.y, bottom: props.bottom },
    { width, height },
    'above',
    { width: window.innerWidth, height: window.innerHeight }
  )
  placed.value = true
}

const select = async (
  item: EditorMenuItem,
  event: MouseEvent
): Promise<void> => {
  if (item.disabled) return

  if (item.children) {
    const { left, top, right, bottom } = (
      event.currentTarget as HTMLElement
    ).getBoundingClientRect()

    emit('open-group', item, { left, top, right, bottom })

    return
  }

  emit('close')

  await item.action?.()
}

const onPointerDown = (event: MouseEvent): void => {
  if (toolbarRef.value?.contains(event.target as Node)) return

  emit('close')
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return

  event.stopPropagation()
  emit('close')
}

const close = (): void => emit('close')

// the toolbar follows a growing selection without being recreated
watch(
  () => [props.x, props.y, props.bottom, props.items.length],
  () => void nextTick(place)
)

onMounted(() => {
  place()

  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', close)
  // scrolling the editor moves the toolbar away from its anchor
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
.editor-bubble-toolbar {
  position: fixed;
  z-index: var(--z-modal);
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 3px;
  background-color: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
}

.editor-bubble-toolbar__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.875rem;
  height: 1.875rem;
  padding: 0 0.375rem;
  color: var(--color-base-content);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.editor-bubble-toolbar__button.has-children {
  padding-right: 0.125rem;
}

.editor-bubble-toolbar__button:hover:not(:disabled) {
  background-color: var(--app-hover);
}

.editor-bubble-toolbar__button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.editor-bubble-toolbar__button:disabled {
  color: var(--app-text-faint);
  cursor: default;
}

.editor-bubble-toolbar__caret {
  color: var(--app-text-faint);
}

.editor-bubble-toolbar__separator {
  align-self: stretch;
  width: 1px;
  margin: 0.25rem 2px;
  background-color: var(--app-border-subtle);
}
</style>
