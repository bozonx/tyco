<template>
  <div class="split-preview-container">
    <div class="split-panes" @wheel.passive="handleContainerWheel">
      <div class="split-column">
        <div class="column-header">
          <span class="column-title">{{ leftTitle }}</span>
        </div>
        <div
          ref="leftPane"
          class="column-body"
          :class="{ 'is-flush': flushLeft }"
          @pointerenter="activeSide = 'left'"
          @scroll.capture="syncScroll($event, 'left')"
        >
          <slot name="left" />
        </div>
      </div>
      <div class="split-column">
        <div class="column-header">
          <span class="column-title">{{ rightTitle }}</span>
        </div>
        <div
          ref="rightPane"
          class="column-body"
          :class="{ 'is-flush': flushRight }"
          @pointerenter="activeSide = 'right'"
          @scroll.capture="syncScroll($event, 'right')"
        >
          <slot name="right" />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

defineProps<{
  leftTitle: string
  rightTitle: string
  flushLeft?: boolean
  flushRight?: boolean
}>()
const leftPane = ref<HTMLElement | null>(null)
const rightPane = ref<HTMLElement | null>(null)

let activeSide: 'left' | 'right' | null = null
let syncTimeout: ReturnType<typeof setTimeout> | undefined

function syncScroll(event: Event, side: 'left' | 'right') {
  if (activeSide !== null && activeSide !== side) return

  activeSide = side
  if (syncTimeout !== undefined) clearTimeout(syncTimeout)
  syncTimeout = setTimeout(() => {
    activeSide = null
  }, 100)

  const targetPane = side === 'left' ? rightPane.value : leftPane.value
  const source = event.target as HTMLElement
  const target = targetPane?.querySelector('textarea') ?? targetPane
  if (!target) return

  const sourceMax = source.scrollHeight - source.clientHeight
  const targetMax = target.scrollHeight - target.clientHeight

  let nextScrollTop: number
  if (sourceMax <= 0 || targetMax <= 0 || Math.abs(sourceMax - targetMax) < 5) {
    nextScrollTop = source.scrollTop
  } else {
    const ratio = source.scrollTop / sourceMax
    nextScrollTop = Math.round(ratio * targetMax)
  }

  if (target.scrollTop !== nextScrollTop) {
    target.scrollTop = nextScrollTop
  }
}

function handleContainerWheel(event: WheelEvent) {
  if (event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.column-body')) return

  const delta = event.deltaMode === 1 ? event.deltaY * 24 : event.deltaY
  if (leftPane.value) {
    leftPane.value.scrollTop += delta
  }
}

onUnmounted(() => {
  if (syncTimeout !== undefined) clearTimeout(syncTimeout)
})
</script>
<style scoped>
.split-preview-container {
  container: split-preview / inline-size;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.split-panes {
  display: flex;
  gap: var(--space-xs);
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
}
.split-column {
  flex: 1 1 50%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  overflow: hidden;
}
.column-header {
  padding: var(--space-xs) var(--space-md);
  background-color: var(--app-surface-sunken);
  border-bottom: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.column-title {
  font-size: var(--text-caption);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--app-text-muted);
}
.column-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: var(--preview-font-size);
  line-height: var(--preview-line-height);
  padding: var(--space-sm) var(--space-md);
  white-space: pre-wrap;
  word-break: break-word;
}
.column-body.is-flush {
  display: flex;
  flex-direction: column;
  padding: 0;
}
@container split-preview (max-width: 40rem) {
  .split-panes {
    flex-direction: column;
  }
}
</style>
