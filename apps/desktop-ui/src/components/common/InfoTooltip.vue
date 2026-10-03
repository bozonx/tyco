<template>
  <div
    ref="containerRef"
    class="info-tooltip-container"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <button
      ref="triggerRef"
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

    <Teleport to="body" :disabled="!teleport">
      <Transition name="tooltip-fade">
        <div
          v-if="isOpen"
          ref="popoverRef"
          class="info-tooltip-popover"
          :class="[
            teleport ? 'is-teleported' : 'is-inline',
            currentPlacement === 'bottom'
              ? 'placement-bottom'
              : 'placement-top',
            alignClass,
          ]"
          :style="popoverStyle"
          role="tooltip"
          @mouseenter="onPopoverMouseEnter"
          @mouseleave="onPopoverMouseLeave"
        >
          <slot>{{ text }}</slot>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  type CSSProperties,
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'

import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    text?: string
    ariaLabel?: string
    placement?: 'top' | 'bottom'
    align?: 'start' | 'center' | 'end'
    size?: 'sm' | 'md'
    teleport?: boolean
  }>(),
  {
    text: '',
    ariaLabel: 'Info',
    placement: 'top',
    align: 'start',
    size: 'sm',
    teleport: true,
  }
)

const isOpen = ref(false)
const isPinned = ref(false)
const currentPlacement = ref<'top' | 'bottom'>('top')
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)
const popoverStyle = ref<CSSProperties>({})

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

function updatePosition() {
  if (!triggerRef.value) return

  if (!props.teleport) {
    currentPlacement.value = props.placement
    popoverStyle.value = {}
    return
  }

  const rect = triggerRef.value.getBoundingClientRect()
  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom
  const gap = 6
  const margin = 8

  const popoverEl = popoverRef.value
  const tooltipWidth = popoverEl?.offsetWidth || 280
  const tooltipHeight = popoverEl?.offsetHeight || 60

  let effectivePlacement = props.placement
  if (
    effectivePlacement === 'top' &&
    spaceAbove < tooltipHeight + gap &&
    spaceBelow > spaceAbove
  ) {
    effectivePlacement = 'bottom'
  } else if (
    effectivePlacement === 'bottom' &&
    spaceBelow < tooltipHeight + gap &&
    spaceAbove > spaceBelow
  ) {
    effectivePlacement = 'top'
  }

  currentPlacement.value = effectivePlacement

  let top: number
  if (effectivePlacement === 'top') {
    top = Math.max(margin, rect.top - tooltipHeight - gap)
  } else {
    top = Math.min(
      rect.bottom + gap,
      Math.max(margin, window.innerHeight - tooltipHeight - margin)
    )
  }

  let left: number
  if (props.align === 'center') {
    left = rect.left + rect.width / 2 - tooltipWidth / 2
  } else if (props.align === 'end') {
    left = rect.right - tooltipWidth
  } else {
    left = rect.left
  }

  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin)
  left = Math.max(margin, Math.min(left, maxLeft))

  popoverStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    bottom: 'auto',
    right: 'auto',
    zIndex: '9999',
  }
}

async function openTooltip() {
  clearCloseTimeout()
  isOpen.value = true
  await nextTick()
  updatePosition()
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      if (isOpen.value) {
        updatePosition()
      }
    })
  }
}

function onMouseEnter() {
  void openTooltip()
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
    void openTooltip()
  }
}

function close() {
  clearCloseTimeout()
  isPinned.value = false
  isOpen.value = false
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node
  if (
    isOpen.value &&
    containerRef.value &&
    !containerRef.value.contains(target) &&
    (!popoverRef.value || !popoverRef.value.contains(target))
  ) {
    close()
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    close()
  }
}

function onScrollOrResize() {
  if (isOpen.value) {
    updatePosition()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})

onUnmounted(() => {
  clearCloseTimeout()
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})

defineExpose({ isOpen, isPinned, close, updatePosition })
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
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-lg);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.45;
  color: var(--color-base-content);
  white-space: pre-line;
  word-break: break-word;
  pointer-events: auto;
  user-select: text;
  box-sizing: border-box;
}

.info-tooltip-popover.is-teleported {
  position: fixed;
  z-index: 9999;
}

.info-tooltip-popover.is-inline.placement-top {
  bottom: calc(100% + 6px);
  top: auto;
}

.info-tooltip-popover.is-inline.placement-bottom {
  top: calc(100% + 6px);
  bottom: auto;
}

.info-tooltip-popover.is-inline.align-start {
  left: 0;
  right: auto;
}

.info-tooltip-popover.is-inline.align-center {
  left: 50%;
  right: auto;
  transform: translateX(-50%);
}

.info-tooltip-popover.is-inline.align-end {
  right: 0;
  left: auto;
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
  transform: translateY(3px);
}
</style>
