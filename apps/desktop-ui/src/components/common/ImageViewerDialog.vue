<template>
  <BaseDialog
    :open="open"
    size="full"
    frameless
    :label="dialogLabel"
    class="image-viewer-dialog"
    @close="emit('close')"
  >
    <div
      ref="stageRef"
      class="image-viewer-stage"
      :class="{ 'is-dragging': isDragging }"
      @wheel.prevent="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
      @lostpointercapture="handleLostPointerCapture"
      @dblclick="handleDoubleClick"
    >
      <img
        v-if="src"
        ref="imgRef"
        :src="src"
        :alt="altText"
        class="image-viewer-img"
        :class="{ 'is-light-surface': lightSurface }"
        :style="imageStyle"
        draggable="false"
      />
      <IconButton
        autofocus
        size="md"
        variant="neutral"
        class="image-viewer-close"
        :label="t('chat.closeImage')"
        icon="mdi:close"
        @click="emit('close')"
      />
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { createImageViewerModel } from '../../lib/ui/image-viewer-model'
import BaseDialog from './BaseDialog.vue'
import IconButton from './IconButton.vue'

const props = defineProps<{
  open: boolean
  src: string
  alt?: string
  label?: string
  /** Places a light backdrop behind transparent diagrams with dark strokes */
  lightSurface?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const stageRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

const model = createImageViewerModel()
const viewState = ref(model.getState())
const isDragging = ref(false)

let activePointerId: number | null = null
let pressedOnImage = false
let didDrag = false
let dragStartX = 0
let dragStartY = 0
let lastPointerX = 0
let lastPointerY = 0

const DRAG_THRESHOLD_PX = 4
const DOUBLE_CLICK_ZOOM_SCALE = 2

const altText = computed(() => props.alt || t('chat.imageTitle'))
const dialogLabel = computed(() => props.label || altText.value)

const imageStyle = computed(() => ({
  transform: `translate3d(${viewState.value.offsetX}px, ${viewState.value.offsetY}px, 0) scale(${viewState.value.scale})`,
}))

function resetInteraction() {
  activePointerId = null
  pressedOnImage = false
  didDrag = false
  isDragging.value = false
}

watch(
  [() => props.open, () => props.src],
  ([open]) => {
    if (open) {
      resetInteraction()
      viewState.value = model.reset()
    }
  },
  { immediate: true }
)

function stageRect() {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { left: 0, top: 0, width: 1, height: 1 }
  }
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function contentSize() {
  const img = imgRef.value
  if (!img || img.offsetWidth <= 0 || img.offsetHeight <= 0) return undefined
  return { width: img.offsetWidth, height: img.offsetHeight }
}

function handleWheel(event: WheelEvent) {
  viewState.value = model.zoomByWheel(
    event.deltaY,
    event.deltaMode,
    event.clientX,
    event.clientY,
    stageRect(),
    contentSize()
  )
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (event.target instanceof Element && event.target.closest('button')) return
  activePointerId = event.pointerId
  pressedOnImage =
    event.target instanceof Element && event.target.closest('img') !== null
  didDrag = false
  dragStartX = event.clientX
  dragStartY = event.clientY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  stageRef.value?.setPointerCapture?.(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  if (
    !didDrag &&
    Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) >=
      DRAG_THRESHOLD_PX
  ) {
    didDrag = true
    isDragging.value = true
  }
  if (!didDrag) return
  const dx = event.clientX - lastPointerX
  const dy = event.clientY - lastPointerY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  viewState.value = model.panBy(dx, dy, stageRect(), contentSize())
}

function releaseCapture(pointerId: number) {
  if (stageRef.value?.hasPointerCapture?.(pointerId)) {
    stageRef.value.releasePointerCapture(pointerId)
  }
}

function handlePointerUp(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  const shouldClose = !didDrag && !pressedOnImage
  releaseCapture(event.pointerId)
  resetInteraction()
  if (shouldClose) emit('close')
}

function handlePointerCancel(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  releaseCapture(event.pointerId)
  resetInteraction()
}

function handleLostPointerCapture() {
  resetInteraction()
}

function handleDoubleClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button')) return
  const current = viewState.value
  if (
    Math.abs(current.scale - 1) > 0.05 ||
    current.offsetX !== 0 ||
    current.offsetY !== 0
  ) {
    viewState.value = model.reset()
    return
  }
  if (event.target instanceof Element && event.target.closest('img')) {
    viewState.value = model.zoomTo(
      DOUBLE_CLICK_ZOOM_SCALE,
      event.clientX,
      event.clientY,
      stageRect(),
      contentSize()
    )
  }
}
</script>

<style scoped>
.image-viewer-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.image-viewer-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  cursor: grab;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.image-viewer-img.is-light-surface {
  background: white;
  padding: var(--space-md);
  border-radius: var(--radius-md);
}

.image-viewer-stage.is-dragging,
.image-viewer-stage.is-dragging .image-viewer-img {
  cursor: grabbing;
}

.image-viewer-close {
  position: absolute;
  top: var(--space-lg);
  right: var(--space-lg);
  z-index: 1;
  --btn-color: var(--app-surface-raised);
  border-color: var(--app-border-strong);
  border-radius: 9999px;
  box-shadow: var(--app-shadow-md);
  color: var(--color-base-content);
}
</style>
