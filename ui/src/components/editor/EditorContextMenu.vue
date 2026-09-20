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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { EditorMenuItem } from '../../lib/editor/menuItem'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  /** Координаты в системе viewport — так их отдаёт CodeMirror */
  x: number
  y: number
  items: EditorMenuItem[]
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

/** Зазор от края окна, чтобы меню не прилипало к границе */
const VIEWPORT_GAP = 8

const menuRef = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })

const style = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

/** Развернуть меню внутрь окна, если оно не влезает вправо или вниз */
const fitIntoViewport = (): void => {
  const element = menuRef.value

  if (!element) return

  const { width, height } = element.getBoundingClientRect()
  const maxX = window.innerWidth - width - VIEWPORT_GAP
  const maxY = window.innerHeight - height - VIEWPORT_GAP

  position.value = {
    x: Math.max(VIEWPORT_GAP, Math.min(props.x, maxX)),
    y: Math.max(VIEWPORT_GAP, Math.min(props.y, maxY)),
  }
}

const close = (): void => emit('close')

const select = async (item: EditorMenuItem): Promise<void> => {
  if (item.disabled) return

  close()

  await item.action()
}

const onPointerDown = (event: MouseEvent): void => {
  if (menuRef.value?.contains(event.target as Node)) return

  close()
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  }
}

// bubble-меню переезжает вслед за растущим выделением, не пересоздаваясь
watch(
  () => [props.x, props.y, props.items.length],
  () => fitIntoViewport()
)

onMounted(() => {
  fitIntoViewport()

  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', close)
  // скролл редактора уводит меню от своей позиции — проще закрыть
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
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.editor-context-menu__item {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.8125rem;
  color: oklch(var(--bc));
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.editor-context-menu__item:hover:not(:disabled) {
  background-color: var(--app-surface-raised);
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
