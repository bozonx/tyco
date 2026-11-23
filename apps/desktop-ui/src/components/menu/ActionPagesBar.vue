<template>
  <div
    ref="bar"
    class="action-pages-bar"
    role="group"
    :aria-label="t('settings.mainActionGroups.actionPages')"
  >
    <span
      class="action-page-highlight"
      :style="highlightStyle"
      aria-hidden="true"
    />
    <KeyboardKey class="action-pages-hint">Tab</KeyboardKey>
    <button
      v-for="pageIndex in props.pageIndexes"
      :key="pageIndex"
      type="button"
      tabindex="-1"
      class="action-page-button"
      :class="{ 'is-active': props.activeIndex === pageIndex }"
      :aria-pressed="props.activeIndex === pageIndex"
      @pointerdown="handlePointerDown"
      @click="handleClick($event, pageIndex)"
    >
      <KeyboardKey v-if="pageIndex < 10">{{
        pageIndex === 9 ? 0 : pageIndex + 1
      }}</KeyboardKey>
      <span>{{ t('settings.actionPage', { page: pageIndex + 1 }) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import KeyboardKey from '../common/KeyboardKey.vue'

const props = defineProps<{
  /** Page indexes to show, each labelled with its page number. */
  pageIndexes: readonly number[]
  activeIndex: number
}>()
const emit = defineEmits<{ (e: 'select', pageIndex: number): void }>()
const { t } = useI18n()

const bar = ref<HTMLElement>()
const highlightStyle = ref<Record<string, string>>({ opacity: '0' })

function updateHighlight() {
  const active = bar.value?.querySelector<HTMLElement>('.is-active')
  if (!active) return
  highlightStyle.value = {
    width: `${active.offsetWidth}px`,
    height: `${active.offsetHeight}px`,
    transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
  }
}

watch(
  () => [props.activeIndex, props.pageIndexes] as const,
  () => void nextTick(updateHighlight)
)

/** A mouse click must not take focus away from the letter keys. */
function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse') event.preventDefault()
}

function handleClick(event: MouseEvent, pageIndex: number) {
  ;(event.currentTarget as HTMLElement | null)?.blur()
  emit('select', pageIndex)
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  updateHighlight()
  if (typeof ResizeObserver === 'undefined' || !bar.value) return
  resizeObserver = new ResizeObserver(updateHighlight)
  resizeObserver.observe(bar.value)
})
onUnmounted(() => resizeObserver?.disconnect())
</script>

<style scoped>
/* A segmented control with the page number keys */
.action-pages-bar {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--segment-gap);
  padding: var(--segment-padding);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);

  --key-size: var(--quick-kbd-size);
  --key-font-size: var(--quick-kbd-font-size);
}

.action-pages-hint {
  margin-inline: var(--space-xs);
}

.action-page-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm) var(--space-2xs) var(--space-2xs);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.action-page-button:hover {
  color: var(--color-base-content);
}

.action-page-button.is-active {
  color: var(--color-base-content);
  font-weight: 500;
}

.action-page-button:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 1px;
}

.action-page-highlight {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  box-shadow: var(--app-shadow-segment);
  transition:
    transform 170ms cubic-bezier(0.2, 0, 0, 1),
    width 170ms ease-out,
    height 170ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .action-page-highlight {
    transition: none;
  }
}
</style>
