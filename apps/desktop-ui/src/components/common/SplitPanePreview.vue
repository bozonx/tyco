<template>
  <div class="split-panes">
    <div class="split-column">
      <div class="column-header">
        <span class="column-title">{{ leftTitle }}</span>
      </div>
      <div
        ref="leftPane"
        class="column-body"
        :class="{ 'is-flush': flushLeft }"
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
        @scroll.capture="syncScroll($event, 'right')"
      >
        <slot name="right" />
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
let frame: number | undefined
function syncScroll(event: Event, side: 'left' | 'right') {
  if (frame !== undefined) return
  const targetPane = side === 'left' ? rightPane.value : leftPane.value
  const source = event.target as HTMLElement
  const target = targetPane?.querySelector('textarea') ?? targetPane
  if (!target || target.scrollTop === source.scrollTop) return
  target.scrollTop = source.scrollTop
  frame = requestAnimationFrame(() => {
    frame = undefined
  })
}
onUnmounted(() => {
  if (frame !== undefined) cancelAnimationFrame(frame)
})
</script>
<style scoped>
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
  font-size: 0.9375rem;
  line-height: 1.6;
  padding: var(--space-sm) var(--space-md);
  white-space: pre-wrap;
  word-break: break-word;
}
.column-body.is-flush {
  display: flex;
  flex-direction: column;
  padding: 0;
}
@media (max-width: 640px) {
  .split-panes {
    flex-direction: column;
  }
}
</style>
