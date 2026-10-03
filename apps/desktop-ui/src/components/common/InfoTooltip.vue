<template>
  <div
    ref="containerRef"
    class="info-tooltip-container"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <button
      type="button"
      class="info-tooltip-trigger"
      :class="{ 'info-tooltip-active': isOpen }"
      :aria-label="ariaLabel"
      :aria-expanded="isOpen"
      @click="toggleClick"
      @keydown.escape="close"
    >
      <Icon icon="mdi:information-outline" :height="iconSize" />
    </button>

    <Transition name="tooltip-fade">
      <div
        v-if="isOpen"
        class="info-tooltip-popover"
        :class="[
          placement === 'bottom' ? 'placement-bottom' : 'placement-top',
          alignClass,
        ]"
        role="tooltip"
        @mouseenter="onPopoverMouseEnter"
        @mouseleave="onPopoverMouseLeave"
      >
        <slot>{{ text }}</slot>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    text?: string
    ariaLabel?: string
    placement?: 'top' | 'bottom'
    align?: 'start' | 'center' | 'end'
    size?: 'sm' | 'md'
  }>(),
  { text: '', ariaLabel: 'Info', placement: 'top', align: 'start', size: 'sm' }
)

const isOpen = ref(false)
const isPinned = ref(false)
const containerRef = ref<HTMLElement | null>(null)
let closeTimeout: ReturnType<typeof setTimeout> | null = null

const iconSize = computed(() => (props.size === 'md' ? 17 : 15))

const alignClass = computed(() => {
  if (props.align === 'center') return 'align-center'
  if (props.align === 'end') return 'align-end'
  return 'align-start'
})

function clearCloseTimeout() {
  if (closeTimeout) {
    clearTimeout(closeTimeout)
    closeTimeout = null
  }
}

function onMouseEnter() {
  clearCloseTimeout()
  isOpen.value = true
}

function onMouseLeave() {
  if (!isPinned.value) {
    closeTimeout = setTimeout(() => {
      isOpen.value = false
    }, 150)
  }
}

function onPopoverMouseEnter() {
  clearCloseTimeout()
}

function onPopoverMouseLeave() {
  if (!isPinned.value) {
    closeTimeout = setTimeout(() => {
      isOpen.value = false
    }, 150)
  }
}

function toggleClick(event: MouseEvent) {
  event.stopPropagation()
  clearCloseTimeout()
  if (isPinned.value) {
    isPinned.value = false
    isOpen.value = false
  } else {
    isPinned.value = true
    isOpen.value = true
  }
}

function close() {
  clearCloseTimeout()
  isPinned.value = false
  isOpen.value = false
}

function onDocumentClick(event: MouseEvent) {
  if (
    isOpen.value &&
    containerRef.value &&
    !containerRef.value.contains(event.target as Node)
  ) {
    close()
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  clearCloseTimeout()
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKeydown)
})

defineExpose({ isOpen, isPinned, close })
</script>

<style scoped>
.info-tooltip-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  line-height: 1;
}

.info-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  opacity: 0.7;
  cursor: pointer;
  outline: none;
  transition:
    opacity var(--transition-fast),
    color var(--transition-fast);
}

.info-tooltip-trigger:hover,
.info-tooltip-trigger:focus-visible,
.info-tooltip-active {
  opacity: 1;
  color: var(--color-primary);
}

.info-tooltip-trigger:focus-visible {
  box-shadow: var(--app-focus-ring);
}

.info-tooltip-popover {
  position: absolute;
  z-index: 60;
  width: max-content;
  max-width: 18rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-lg);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: var(--color-base-content);
  white-space: pre-line;
  word-break: break-word;
  pointer-events: auto;
  user-select: text;
}

.placement-top {
  bottom: calc(100% + 6px);
}

.placement-bottom {
  top: calc(100% + 6px);
}

.align-start {
  left: 0;
}

.align-center {
  left: 50%;
  transform: translateX(-50%);
}

.align-end {
  right: 0;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.placement-top.tooltip-fade-enter-from,
.placement-top.tooltip-fade-leave-to {
  transform: translateY(3px);
}

.placement-top.align-center.tooltip-fade-enter-from,
.placement-top.align-center.tooltip-fade-leave-to {
  transform: translate(-50%, 3px);
}

.placement-bottom.tooltip-fade-enter-from,
.placement-bottom.tooltip-fade-leave-to {
  transform: translateY(-3px);
}

.placement-bottom.align-center.tooltip-fade-enter-from,
.placement-bottom.align-center.tooltip-fade-leave-to {
  transform: translate(-50%, -3px);
}
</style>
