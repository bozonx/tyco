<template>
  <div
    ref="rootRef"
    class="screenshot-selector-root"
    tabindex="-1"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
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
      >
        <div class="selection-badge">{{ badgeText }}</div>
        <button
          v-if="!isDragging"
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

const emit = defineEmits<{ confirm: [crop: CropRect]; cancel: [] }>()

const { t } = useI18n()

const rootRef = ref<HTMLElement>()
const imageUrl = ref('')
const isDragging = ref(false)
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
  if (e.button !== 0) return
  updateView()
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragEnd.value = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return
  dragEnd.value = { x: e.clientX, y: e.clientY }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return
  dragEnd.value = { x: e.clientX, y: e.clientY }
  const rect = dragRect(dragStart.value, dragEnd.value, imageRect.value)
  isDragging.value = false
  ;(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId)
  // A click keeps the previous selection, so a double-click can confirm it.
  if (isSelection(rect)) selected.value = rect
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
    e.stopPropagation()
    onCancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onConfirm()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('resize', updateView)
  updateView()
  rootRef.value?.focus()
  try {
    const bytes = await getChatImage(props.selection.imageId)
    imageUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: 'image/webp' })
    )
  } catch {
    onCancel()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', updateView)
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

.selection-badge {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  padding: 2px 6px;
  font-size: 11px;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.85);
  color: #ffffff;
  border-radius: 3px;
  white-space: nowrap;
}

.selection-confirm {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
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
