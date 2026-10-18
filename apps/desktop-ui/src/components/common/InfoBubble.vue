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
      :aria-label="ariaLabel ?? translate('common.info')"
      :aria-describedby="isOpen ? tooltipId : undefined"
      @focus="onMouseEnter"
      @blur="onTriggerBlur"
      :aria-haspopup="interactive ? 'dialog' : undefined"
      :aria-controls="interactive && isOpen ? tooltipId : undefined"
      @keydown.down.prevent="openInteractive"
      :aria-expanded="isOpen"
      @click="toggleClick"
      @keydown.escape.stop.prevent="dismiss"
    >
      <AppIcon icon="mdi:information-outline" :size="iconSize" />
    </button>

    <Teleport to="body" :disabled="!shouldTeleport">
      <Transition name="tooltip-fade">
        <div
          v-if="isOpen"
          ref="popoverRef"
          class="info-tooltip-popover"
          :class="[
            shouldTeleport ? 'is-teleported' : 'is-inline',
            currentPlacement === 'bottom'
              ? 'placement-bottom'
              : 'placement-top',
            alignClass,
          ]"
          :style="popoverStyle"
          :data-theme="panelTheme"
          :id="tooltipId"
          :role="interactive ? 'dialog' : 'tooltip'"
          :aria-label="
            interactive ? (ariaLabel ?? translate('common.info')) : undefined
          "
          :tabindex="interactive ? -1 : undefined"
          @focusout="onPanelFocusout"
          @keydown="onPanelKeydown"
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
import { computed, nextTick, onUnmounted, ref, useId } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import {
  isWithinDismissibleLayer,
  useDismissibleLayer,
} from '../../composables/use-dismissible-layer'
import { translate } from '../../lib/i18n'
import { focusAfterTrigger } from '../../lib/ui/focus-navigation'
import type { IconSize } from '../../lib/ui/icon-size'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    interactive?: boolean
    text?: string
    ariaLabel?: string
    placement?: 'top' | 'bottom'
    align?: 'start' | 'center' | 'end'
    size?: 'sm' | 'md'
    teleport?: boolean
  }>(),
  { text: '', placement: 'top', align: 'start', size: 'sm', teleport: true }
)

const tooltipId = useId()
const isOpen = ref(false)
const isPinned = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)

const shouldTeleport = computed(
  () => props.teleport && !containerRef.value?.closest('dialog')
)

let closeTimeout: ReturnType<typeof setTimeout> | null = null

const iconSize = computed<IconSize>(() => (props.size === 'md' ? 'lg' : 'sm'))

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

const {
  style: popoverStyle,
  placement: currentPlacement,
  theme: panelTheme,
  updatePosition,
} = useAnchoredPanel({
  isOpen: () => isOpen.value,
  anchor: () => triggerRef.value,
  panel: () => popoverRef.value,
  placement: () => props.placement,
  align: () => props.align,
  enabled: () => shouldTeleport.value,
})

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
  if (!isPinned.value && document.activeElement !== triggerRef.value) {
    closeTimeout = setTimeout(() => {
      isOpen.value = false
    }, 150)
  }
}

function onPopoverMouseEnter() {
  clearCloseTimeout()
}

function onPopoverMouseLeave() {
  if (!isPinned.value && document.activeElement !== triggerRef.value) {
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
    if (props.interactive) void openInteractive()
    else void openTooltip()
  }
}

function close() {
  clearCloseTimeout()
  isPinned.value = false
  isOpen.value = false
}

function focusableElements() {
  return Array.from(
    popoverRef.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    ) ?? []
  )
}

async function openInteractive() {
  if (!props.interactive) return
  isPinned.value = true
  await openTooltip()
  ;(focusableElements()[0] ?? popoverRef.value)?.focus()
}

function dismiss() {
  const restoreFocus =
    props.interactive && popoverRef.value?.contains(document.activeElement)
  close()
  if (restoreFocus) triggerRef.value?.focus()
  // Focusing the trigger must not reopen a dismissed panel.
  close()
}

function onTriggerBlur() {
  if (!props.interactive) close()
  else void onPanelFocusout()
}

async function onPanelFocusout() {
  if (!props.interactive) return
  await nextTick()
  const active = document.activeElement
  if (!isWithinDismissibleLayer([containerRef.value, popoverRef.value], active))
    close()
}

function onPanelKeydown(event: KeyboardEvent) {
  if (!props.interactive || event.key !== 'Tab') return
  const elements = focusableElements()
  const first = elements[0] ?? popoverRef.value
  const last = elements.at(-1) ?? popoverRef.value
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    triggerRef.value?.focus()
    close()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    if (triggerRef.value) focusAfterTrigger(triggerRef.value, popoverRef.value)
    close()
  }
}

useDismissibleLayer({
  isOpen: () => isOpen.value,
  elements: () => [containerRef.value, popoverRef.value],
  dismiss,
})
onUnmounted(clearCloseTimeout)

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
  z-index: var(--z-tooltip);
  width: max-content;
  max-width: min(18rem, calc(100vw - 1rem));
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-lg);
  font-size: var(--text-caption);
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
  z-index: var(--z-tooltip);
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
