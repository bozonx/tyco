<template>
  <div
    ref="rootRef"
    class="screenshot-selector-root"
    tabindex="-1"
    @pointerdown.stop="onPointerDown"
    @lostpointercapture="onLostPointerCapture"
    @dblclick="onConfirm"
    @contextmenu.prevent="onCancel"
  >
    <img
      v-if="imageUrl"
      :src="imageUrl"
      class="screenshot-selector-image"
      :style="{
        left: px(imageRect.x),
        top: px(imageRect.y),
        width: px(imageRect.width),
        height: px(imageRect.height),
      }"
      alt=""
      draggable="false"
    />

    <template v-if="shownRect">
      <!-- Dimmed exterior -->
      <div
        class="dimmed-area"
        :style="{
          top: '0px',
          left: '0px',
          right: '0px',
          height: px(shownRect.y),
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: px(shownRect.y + shownRect.height),
          left: '0px',
          right: '0px',
          bottom: '0px',
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: px(shownRect.y),
          left: '0px',
          width: px(shownRect.x),
          height: px(shownRect.height),
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: px(shownRect.y),
          left: px(shownRect.x + shownRect.width),
          right: '0px',
          height: px(shownRect.height),
        }"
      />

      <div
        class="selection-box"
        :style="{
          left: px(shownRect.x),
          top: px(shownRect.y),
          width: px(shownRect.width),
          height: px(shownRect.height),
        }"
      />
      <div
        class="selection-label-row"
        :style="{
          top: `clamp(8px, ${px(shownRect.y < 32 ? shownRect.y + 6 : shownRect.y - 28)}, calc(100% - 28px))`,
          '--selection-gap': px(Math.max(0, shownRect.x - 8)),
        }"
      >
        <div class="selection-badge">{{ badgeText }}</div>
      </div>
      <div
        v-if="!isDragging"
        class="selection-action-row"
        :style="{
          bottom: `max(8px, ${px(view.height - shownRect.y - shownRect.height - 38)})`,
          '--selection-gap': px(
            Math.max(0, view.width - shownRect.x - shownRect.width - 8)
          ),
        }"
      >
        <button
          type="button"
          class="selection-confirm"
          @pointerdown.stop
          @click.stop="onConfirm"
        >
          {{ t('screenshot.confirmArea') }}
        </button>
      </div>
    </template>
    <div v-else class="dimmed-full" />

    <div v-if="!isDragging" class="selection-hint">
      {{
        t(
          shownRect
            ? 'screenshot.confirmAreaInstruction'
            : 'screenshot.selectAreaInstruction'
        )
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import {
  type Size,
  type ViewRect,
  dragRect,
  fittedImageRect,
  isSelection,
  toPhysicalCrop,
} from '../../lib/screenshot/area-selection'
import type { CropRect, ScreenshotAreaSelection } from '@tyco/shared'

const props = defineProps<{ selection: ScreenshotAreaSelection }>()

const emit = defineEmits<{
  confirm: [crop: CropRect]
  cancel: []
  /** The frozen image could not be read */
  failed: []
}>()

const { t } = useI18n()

const rootRef = ref<HTMLElement>()
const imageUrl = ref('')
const activePointerId = ref<number | null>(null)
const isDragging = computed(() => activePointerId.value !== null)
const dragStart = ref({ x: 0, y: 0 })
const dragEnd = ref({ x: 0, y: 0 })
/** The finished selection, kept until confirmed or redrawn. */
const selected = ref<ViewRect | null>(null)

function measureView(): Size {
  const root = rootRef.value
  return {
    width: root?.clientWidth || window.innerWidth,
    height: root?.clientHeight || window.innerHeight,
  }
}

// The window grows to the monitor after the selector mounts.
const view = ref<Size>(measureView())
const updateView = () => {
  view.value = measureView()
}

const imageSize = computed<Size>(() => ({
  width: props.selection.width,
  height: props.selection.height,
}))

const imageRect = computed(() => fittedImageRect(view.value, imageSize.value))

const shownRect = computed<ViewRect | null>(() => {
  if (!isDragging.value) return selected.value
  const rect = dragRect(dragStart.value, dragEnd.value, imageRect.value)
  return isSelection(rect) ? rect : null
})

const badgeText = computed(() => {
  const rect = shownRect.value
  const crop = rect && toPhysicalCrop(rect, imageRect.value, imageSize.value)
  return crop ? `${crop.width} × ${crop.height} px` : ''
})

const px = (value: number) => `${value}px`

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || isDragging.value) return
  e.preventDefault()
  updateView()
  activePointerId.value = e.pointerId
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragEnd.value = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value) return
  // Recover if the button was released outside the webview without pointerup.
  if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
    finishDrag()
    return
  }
  e.preventDefault()
  dragEnd.value = { x: e.clientX, y: e.clientY }
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId.value || e.button !== 0) return
  dragEnd.value = { x: e.clientX, y: e.clientY }
  finishDrag()
}

function finishDrag() {
  const pointerId = activePointerId.value
  if (pointerId === null) return
  const rect = dragRect(dragStart.value, dragEnd.value, imageRect.value)
  activePointerId.value = null
  const root = rootRef.value
  if (root?.hasPointerCapture?.(pointerId)) {
    root.releasePointerCapture(pointerId)
  }
  // A click keeps the previous selection, so a double-click can confirm it.
  if (isSelection(rect)) selected.value = rect
}

function onLostPointerCapture(e: PointerEvent) {
  if (e.pointerId === activePointerId.value) finishDrag()
}

function onConfirm() {
  if (isDragging.value || !selected.value) return
  const crop = toPhysicalCrop(selected.value, imageRect.value, imageSize.value)
  if (crop) emit('confirm', crop)
}

function onCancel() {
  emit('cancel')
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    onCancel()
  } else if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
    e.preventDefault()
    e.stopImmediatePropagation()
    onConfirm()
  } else {
    e.stopImmediatePropagation()
  }
}

function handleKeyUp(e: KeyboardEvent) {
  e.stopImmediatePropagation()
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)
  window.addEventListener('resize', updateView)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onLostPointerCapture, true)
  window.addEventListener('blur', finishDrag)
  updateView()
  rootRef.value?.focus({ preventScroll: true })
  try {
    const bytes = await getChatImage(props.selection.imageId)
    imageUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: props.selection.mediaType })
    )
  } catch {
    emit('failed')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown, true)
  window.removeEventListener('keyup', handleKeyUp, true)
  window.removeEventListener('resize', updateView)
  window.removeEventListener('pointermove', onPointerMove, true)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointercancel', onLostPointerCapture, true)
  window.removeEventListener('blur', finishDrag)
  finishDrag()
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = ''
  }
})
</script>

<style scoped>
.screenshot-selector-root {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  user-select: none;
  touch-action: none;
  cursor: crosshair;
  overflow: hidden;
  outline: none;
  background: #000000;
  z-index: var(--z-overlay, 99999);
}

.screenshot-selector-image {
  position: absolute;
  pointer-events: none;
}

.dimmed-full,
.dimmed-area {
  position: absolute;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.dimmed-full {
  inset: 0;
}

.selection-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed #ffffff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.selection-label-row,
.selection-action-row {
  position: absolute;
  left: 8px;
  right: 8px;
  display: flex;
  pointer-events: none;
}

/* Shrink the empty gap before clipping a label or a translated button. */
.selection-label-row::before,
.selection-action-row::before {
  content: '';
  flex: 0 1 var(--selection-gap);
}

.selection-action-row {
  flex-direction: row-reverse;
}

.selection-badge,
.selection-confirm {
  flex: 0 0 auto;
  max-width: 100%;
}

.selection-badge {
  padding: 2px 6px;
  font-size: 11px;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.85);
  color: #ffffff;
  border-radius: 3px;
  white-space: nowrap;
}

.selection-confirm {
  padding: 4px 12px;
  font-size: 13px;
  color: var(--color-primary-content);
  background: var(--color-primary);
  border: none;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
}

.selection-hint {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.85);
  color: #ffffff;
  font-size: 13px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
</style>
