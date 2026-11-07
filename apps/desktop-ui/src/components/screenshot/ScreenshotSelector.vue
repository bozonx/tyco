<template>
  <div
    class="screenshot-selector-root"
    tabindex="-1"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @contextmenu.prevent="onCancel"
    @keydown.esc="onCancel"
  >
    <img
      v-if="imageUrl"
      :src="imageUrl"
      class="screenshot-selector-image"
      alt="Screen capture"
      draggable="false"
    />

    <!-- Dimmed exterior -->
    <template v-if="hasSelection">
      <div
        class="dimmed-area"
        :style="{
          top: '0px',
          left: '0px',
          right: '0px',
          height: `${rect.y}px`,
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: `${rect.y + rect.height}px`,
          left: '0px',
          right: '0px',
          bottom: '0px',
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: `${rect.y}px`,
          left: '0px',
          width: `${rect.x}px`,
          height: `${rect.height}px`,
        }"
      />
      <div
        class="dimmed-area"
        :style="{
          top: `${rect.y}px`,
          left: `${rect.x + rect.width}px`,
          right: '0px',
          height: `${rect.height}px`,
        }"
      />

      <!-- Visible selection rectangle -->
      <div
        class="selection-box"
        :style="{
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }"
      >
        <div class="selection-badge">
          {{ badgeText }}
        </div>
      </div>
    </template>
    <div v-else class="dimmed-full" />

    <!-- Instruction hint -->
    <div v-if="!isDragging" class="selection-hint">
      {{ t('screenshot.selectAreaInstruction') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import type { CropRect, ScreenshotAreaSelection } from '@tyco/shared'

const props = defineProps<{ selection: ScreenshotAreaSelection }>()

const emit = defineEmits<{ confirm: [crop: CropRect]; cancel: [] }>()

const { t } = useI18n()

const imageUrl = ref('')
const isDragging = ref(false)
const startX = ref(0)
const startY = ref(0)
const currentX = ref(0)
const currentY = ref(0)

const MIN_DRAG_PX = 4

const rect = computed(() => {
  const x = Math.min(startX.value, currentX.value)
  const y = Math.min(startY.value, currentY.value)
  const width = Math.abs(currentX.value - startX.value)
  const height = Math.abs(currentY.value - startY.value)
  return { x, y, width, height }
})

const hasSelection = computed(
  () => rect.value.width >= MIN_DRAG_PX && rect.value.height >= MIN_DRAG_PX
)

const badgeText = computed(() => {
  const scale = props.selection.scaleFactor || 1
  const w = Math.round(rect.value.width * scale)
  const h = Math.round(rect.value.height * scale)
  return `${w} × ${h} px`
})

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  isDragging.value = true
  startX.value = e.clientX
  startY.value = e.clientY
  currentX.value = e.clientX
  currentY.value = e.clientY
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return
  currentX.value = e.clientX
  currentY.value = e.clientY
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return
  isDragging.value = false
  ;(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId)

  if (!hasSelection.value) {
    startX.value = 0
    startY.value = 0
    currentX.value = 0
    currentY.value = 0
    return
  }

  const scale = props.selection.scaleFactor || 1
  const x = Math.round(rect.value.x * scale)
  const y = Math.round(rect.value.y * scale)
  let width = Math.round(rect.value.width * scale)
  let height = Math.round(rect.value.height * scale)

  if (x >= props.selection.width || y >= props.selection.height) {
    onCancel()
    return
  }
  width = Math.min(width, props.selection.width - x)
  height = Math.min(height, props.selection.height - y)
  if (width < MIN_DRAG_PX || height < MIN_DRAG_PX) {
    onCancel()
    return
  }

  const crop: CropRect = { x, y, width, height }
  emit('confirm', crop)
}

function onCancel() {
  emit('cancel')
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown)
  try {
    const bytes = await getChatImage(props.selection.imageId)
    imageUrl.value = URL.createObjectURL(
      new Blob([bytes], { type: 'image/webp' })
    )
  } catch {
    // If the image fails to load, cancel cleanly
    onCancel()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
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
  z-index: var(--z-overlay, 99999);
}

.screenshot-selector-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.dimmed-full {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.dimmed-area {
  position: absolute;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
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
