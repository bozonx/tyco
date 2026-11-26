<template>
  <div
    ref="scroller"
    class="dialog-feed"
    :class="{ 'is-bubbles': isBubble, 'is-marquee-active': isMarqueeActive }"
    role="log"
    aria-live="polite"
    :aria-label="t('dialog.feedLabel')"
    @scroll.passive="onScroll"
    @pointerdown="onPointerDown"
  >
    <div
      v-if="marqueeBox"
      class="dialog-marquee-rect"
      :style="{
        left: `${marqueeBox.left}px`,
        top: `${marqueeBox.top}px`,
        width: `${marqueeBox.width}px`,
        height: `${marqueeBox.height}px`,
      }"
    />
    <template
      v-for="item in items"
      :key="item.type === 'turn' ? item.turn.id : item.sessionBreak.id"
    >
      <DialogTurn
        v-if="item.type === 'turn'"
        :turn="item.turn"
        :is-bubble="isBubble"
        :is-translation-only="isTranslationOnly"
        :translation-lang="translationLang"
        :is-selected="isSelected(item.turn.id)"
        :is-selection-mode="hasSelection"
        :is-excluded="isExcluded(item.turn)"
        :use-translation="useTranslation"
        @retry="(ids) => emit('retry', ids)"
        @select="(event) => emit('select-turn', item.turn.id, event.shiftKey)"
        @toggle-single="() => emit('toggle-single-turn', item.turn.id)"
        @contextmenu="(event) => openContextMenu(event, item.turn)"
      />
      <div v-else class="dialog-feed-break">
        <span class="dialog-feed-break-line" />
        <div class="dialog-feed-break-content">
          <span class="dialog-feed-break-badge">
            <AppIcon
              :icon="
                item.sessionBreak.isRecording
                  ? 'mdi:record-circle-outline'
                  : 'mdi:play-pause'
              "
              size="xs"
              :class="{ 'is-recording': item.sessionBreak.isRecording }"
            />
            <span>{{ breakLabel(item.sessionBreak) }}</span>
            <span class="dialog-feed-break-time">{{
              formatTime(item.sessionBreak.timestampMs)
            }}</span>
          </span>
          <DialogRecordingPlayer
            v-if="item.sessionBreak.recordingFile && dialogId"
            :dialog-id="dialogId"
            :file="item.sessionBreak.recordingFile"
            :is-missing="
              recordingExists?.[item.sessionBreak.recordingFile] === false
            "
            :is-incomplete="
              incompleteRecordingFiles?.includes(
                item.sessionBreak.recordingFile
              ) ?? false
            "
          />
        </div>
        <span class="dialog-feed-break-line" />
      </div>
    </template>
    <slot v-if="!hasTurns" name="empty" />

    <DialogTurnContextMenu
      v-if="contextMenuState"
      :x="contextMenuState.x"
      :y="contextMenuState.y"
      :is-selected="isSelected(contextMenuState.turn.id)"
      :has-selection="hasSelection"
      :has-translation="turnHasTranslation(contextMenuState.turn)"
      @action="onContextMenuAction"
      @close="contextMenuState = null"
    />
  </div>
  <Button
    v-if="!isFollowing && items.length > 0"
    class="dialog-feed-latest"
    size="sm"
    icon="mdi:arrow-down"
    @click="scrollToEnd"
    >{{ t('dialog.toLatest') }}</Button
  >
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { formatBreakTime } from '../../lib/dialog/dialog-history-list'
import {
  MARQUEE_DRAG_THRESHOLD_PX,
  type MarqueeSelectionMode,
  computeMarqueeRect,
  computeMarqueeSelection,
  getMarqueeMode,
  isMarqueeIgnoredTarget,
  rectsIntersect,
} from '../../lib/dialog/dialog-marquee-selection'
import type {
  DialogFeedItem,
  DialogSessionBreak,
  DialogTurn as DialogTurnType,
} from '../../lib/dialog/dialog-transcript'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import DialogRecordingPlayer from './DialogRecordingPlayer.vue'
import DialogTurn from './DialogTurn.vue'
import DialogTurnContextMenu from './DialogTurnContextMenu.vue'

/** How close to the end still counts as being at the end, in pixels */
const FOLLOW_THRESHOLD_PX = 48

const props = defineProps<{
  items: readonly DialogFeedItem[]
  isBubble: boolean
  /** A translated turn shows its translation without the original */
  isTranslationOnly: boolean
  translationLang?: string
  dialogId?: string | null
  recordingExists?: Record<string, boolean>
  incompleteRecordingFiles?: readonly string[]
  selectedTurnIds?: readonly string[]
  selectionIncludeMe?: boolean
  useTranslation?: boolean
}>()

const emit = defineEmits<{
  /** Translate these segments again */
  (e: 'retry', ids: string[]): void
  /** Shift+click on a turn to select/extend range */
  (e: 'select-turn', turnId: string, isShift: boolean): void
  /** Toggle single turn selection */
  (e: 'toggle-single-turn', turnId: string): void
  /** Select range up to this turn */
  (e: 'select-range-up-to', turnId: string): void
  /** Select multiple turns from marquee */
  (e: 'select-turns', turnIds: string[]): void
  /** Clear all turn selection */
  (e: 'clear-selection'): void
  /** Copy a turn's original text */
  (e: 'copy-turn-text', turnId: string): void
  /** Copy a turn's translated text */
  (e: 'copy-turn-translation', turnId: string): void
}>()

const { t, locale } = useI18n()
const scroller = ref<HTMLElement | null>(null)
/** Follows new speech until the user scrolls up to read */
const isFollowing = ref(true)

interface MarqueeSession {
  startClientX: number
  startClientY: number
  startContentX: number
  startContentY: number
  currentContentX: number
  currentContentY: number
  mode: MarqueeSelectionMode
  baseSelectedIds: string[]
  isDragging: boolean
}

const marqueeSession = ref<MarqueeSession | null>(null)
const isMarqueeActive = computed(
  () => marqueeSession.value?.isDragging ?? false
)

const marqueeBox = computed(() => {
  const session = marqueeSession.value
  if (!session || !session.isDragging) return null
  const left = Math.min(session.startContentX, session.currentContentX)
  const top = Math.min(session.startContentY, session.currentContentY)
  const width = Math.abs(session.currentContentX - session.startContentX)
  const height = Math.abs(session.currentContentY - session.startContentY)
  return { left, top, width, height }
})

const allTurnIds = computed(() =>
  props.items.flatMap((item) => (item.type === 'turn' ? [item.turn.id] : []))
)

let autoScrollAnimationId: number | null = null
let latestPointerEvent: PointerEvent | null = null

function stopAutoScroll() {
  if (autoScrollAnimationId !== null) {
    cancelAnimationFrame(autoScrollAnimationId)
    autoScrollAnimationId = null
  }
}

function updateSelectionFromCurrentPointer() {
  const session = marqueeSession.value
  const element = scroller.value
  if (!session || !session.isDragging || !element || !latestPointerEvent) return

  const scrollerRect = element.getBoundingClientRect()
  const screenStartX =
    session.startContentX - element.scrollLeft + scrollerRect.left
  const screenStartY =
    session.startContentY - element.scrollTop + scrollerRect.top

  const marqueeScreenRect = computeMarqueeRect(
    screenStartX,
    screenStartY,
    latestPointerEvent.clientX,
    latestPointerEvent.clientY
  )

  const turnElements = element.querySelectorAll<HTMLElement>('[data-turn-id]')
  const intersectedIds: string[] = []

  turnElements.forEach((turnEl) => {
    const id = turnEl.getAttribute('data-turn-id')
    if (!id) return
    const rect = turnEl.getBoundingClientRect()
    if (rectsIntersect(marqueeScreenRect, rect)) {
      intersectedIds.push(id)
    }
  })

  const newSelection = computeMarqueeSelection(
    session.baseSelectedIds,
    intersectedIds,
    session.mode,
    allTurnIds.value
  )

  emit('select-turns', newSelection)
}

function stepAutoScroll() {
  const session = marqueeSession.value
  const element = scroller.value
  if (!session || !session.isDragging || !element || !latestPointerEvent) {
    stopAutoScroll()
    return
  }

  const scrollerRect = element.getBoundingClientRect()
  const AUTO_SCROLL_MARGIN = 32
  const AUTO_SCROLL_MAX_SPEED = 16
  let scrollDelta = 0

  if (latestPointerEvent.clientY < scrollerRect.top + AUTO_SCROLL_MARGIN) {
    const intensity = Math.min(
      1,
      (scrollerRect.top + AUTO_SCROLL_MARGIN - latestPointerEvent.clientY) /
        AUTO_SCROLL_MARGIN
    )
    scrollDelta = -Math.round(Math.max(2, intensity * AUTO_SCROLL_MAX_SPEED))
  } else if (
    latestPointerEvent.clientY >
    scrollerRect.bottom - AUTO_SCROLL_MARGIN
  ) {
    const intensity = Math.min(
      1,
      (latestPointerEvent.clientY -
        (scrollerRect.bottom - AUTO_SCROLL_MARGIN)) /
        AUTO_SCROLL_MARGIN
    )
    scrollDelta = Math.round(Math.max(2, intensity * AUTO_SCROLL_MAX_SPEED))
  }

  if (scrollDelta !== 0) {
    element.scrollTop += scrollDelta
    session.currentContentY =
      latestPointerEvent.clientY - scrollerRect.top + element.scrollTop
    updateSelectionFromCurrentPointer()
    autoScrollAnimationId = requestAnimationFrame(stepAutoScroll)
  } else {
    stopAutoScroll()
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (isMarqueeIgnoredTarget(event.target)) return
  const element = scroller.value
  if (!element) return

  const scrollerRect = element.getBoundingClientRect()
  const startContentX = event.clientX - scrollerRect.left + element.scrollLeft
  const startContentY = event.clientY - scrollerRect.top + element.scrollTop

  marqueeSession.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startContentX,
    startContentY,
    currentContentX: startContentX,
    currentContentY: startContentY,
    mode: getMarqueeMode(event),
    baseSelectedIds: [...(props.selectedTurnIds ?? [])],
    isDragging: false,
  }

  latestPointerEvent = event
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

function onWindowPointerMove(event: PointerEvent) {
  const session = marqueeSession.value
  const element = scroller.value
  if (!session || !element) return

  latestPointerEvent = event

  if (!session.isDragging) {
    const dist = Math.hypot(
      event.clientX - session.startClientX,
      event.clientY - session.startClientY
    )
    if (dist >= MARQUEE_DRAG_THRESHOLD_PX) {
      session.isDragging = true
      isFollowing.value = false
    }
  }

  if (session.isDragging) {
    const scrollerRect = element.getBoundingClientRect()
    session.currentContentX =
      event.clientX - scrollerRect.left + element.scrollLeft
    session.currentContentY =
      event.clientY - scrollerRect.top + element.scrollTop

    updateSelectionFromCurrentPointer()

    const AUTO_SCROLL_MARGIN = 32
    if (
      event.clientY < scrollerRect.top + AUTO_SCROLL_MARGIN ||
      event.clientY > scrollerRect.bottom - AUTO_SCROLL_MARGIN
    ) {
      if (autoScrollAnimationId === null) {
        autoScrollAnimationId = requestAnimationFrame(stepAutoScroll)
      }
    } else {
      stopAutoScroll()
    }
  }
}

function onWindowPointerUp(event: PointerEvent) {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
  stopAutoScroll()

  const session = marqueeSession.value
  if (session && !session.isDragging) {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      emit('clear-selection')
    }
  }

  marqueeSession.value = null
  latestPointerEvent = null
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
  stopAutoScroll()
})

const contextMenuState = ref<{
  x: number
  y: number
  turn: DialogTurnType
} | null>(null)

const hasTurns = computed(() =>
  props.items.some((item) => item.type === 'turn')
)

const hasSelection = computed(() => (props.selectedTurnIds?.length ?? 0) > 0)

function isSelected(turnId: string): boolean {
  return Boolean(props.selectedTurnIds?.includes(turnId))
}

function isExcluded(turn: DialogTurnType): boolean {
  return (
    isSelected(turn.id) &&
    turn.side === 'me' &&
    props.selectionIncludeMe === false
  )
}

function turnHasTranslation(turn: DialogTurnType): boolean {
  return turn.segments.some(
    (s) => s.translationState === 'complete' && Boolean(s.translation)
  )
}

function openContextMenu(event: MouseEvent, turn: DialogTurnType) {
  contextMenuState.value = { x: event.clientX, y: event.clientY, turn }
}

function onContextMenuAction(
  action:
    'toggle-select' | 'select-range-up-to' | 'copy-turn' | 'copy-translation'
) {
  if (!contextMenuState.value) return
  const turn = contextMenuState.value.turn
  if (action === 'toggle-select') {
    emit('toggle-single-turn', turn.id)
  } else if (action === 'select-range-up-to') {
    emit('select-range-up-to', turn.id)
  } else if (action === 'copy-turn') {
    emit('copy-turn-text', turn.id)
  } else if (action === 'copy-translation') {
    emit('copy-turn-translation', turn.id)
  }
}

function breakLabel(sessionBreak: DialogSessionBreak): string {
  if (sessionBreak.action === 'started') {
    return sessionBreak.isRecording
      ? t('dialog.sessionStartedRecording')
      : t('dialog.sessionStartedListening')
  }
  return sessionBreak.isRecording
    ? t('dialog.sessionResumedRecording')
    : t('dialog.sessionResumedListening')
}

function formatTime(timestampMs: number): string {
  return formatBreakTime(timestampMs, locale.value, Date.now(), (date, time) =>
    t('dialog.breakTimestampAt', { date, time })
  )
}

function onScroll() {
  const element = scroller.value
  if (!element) return
  isFollowing.value =
    element.scrollHeight - element.scrollTop - element.clientHeight <
    FOLLOW_THRESHOLD_PX
}

function scrollToEnd() {
  const element = scroller.value
  if (!element) return
  element.scrollTop = element.scrollHeight
  isFollowing.value = true
}

watch(
  () => props.items,
  async () => {
    if (!isFollowing.value) return
    await nextTick()
    scrollToEnd()
  },
  { flush: 'post' }
)

onMounted(scrollToEnd)
</script>

<style scoped>
.dialog-feed {
  position: relative;
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: var(--space-md);
}

.dialog-feed.is-marquee-active {
  user-select: none;
  cursor: crosshair;
}

.dialog-marquee-rect {
  position: absolute;
  pointer-events: none;
  z-index: 10;
  border: 1px solid var(--color-primary);
  background-color: color-mix(in oklab, var(--color-primary) 14%, transparent);
  border-radius: var(--radius-sm);
}

.dialog-feed-break {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: var(--space-xs) 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  user-select: none;
}

.dialog-feed-break-line {
  flex: 1;
  height: 1px;
  background-color: var(--app-border-subtle);
}

.dialog-feed-break-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  max-width: 100%;
}

.dialog-feed-break-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 2px var(--space-xs);
  background-color: var(--app-surface-sunken);
  border-radius: var(--radius-full);
}

.dialog-feed-break-badge .is-recording {
  color: var(--color-error);
}

.dialog-feed-break-time {
  opacity: 0.75;
}

.dialog-feed-latest {
  position: absolute;
  bottom: var(--space-md);
  left: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 0.15));
}
</style>
