<template>
  <div
    ref="rootRef"
    class="subtitles-root"
    :class="{ 'is-anchored': isAnchored }"
  >
    <div
      ref="subtitlesRef"
      class="subtitles"
      :class="{ 'is-anchored': isAnchored }"
      @mousedown.left="startDragging"
    >
      <div ref="textRef" class="subtitles-text" aria-live="polite">
        <p
          v-if="view.errorText"
          ref="errorRef"
          class="subtitles-error"
          role="alert"
          :title="view.errorText"
        >
          {{ view.errorText }}
        </p>
        <div
          v-if="hasMainContent"
          ref="mainScrollRef"
          class="subtitles-main-scroll"
          :class="{ 'has-secondary': Boolean(view.secondaryText) }"
          :style="mainScrollStyle"
        >
          <p ref="mainTextRef" class="subtitles-main">
            <span v-if="view.mainText" :lang="view.mainLang ?? undefined">{{
              view.mainText
            }}</span
            ><template v-if="trimmedPendingText"
              >{{ view.mainText ? ' ' : ''
              }}<span class="subtitles-pending" aria-hidden="true">{{
                trimmedPendingText
              }}</span></template
            >
          </p>
        </div>
        <div
          v-if="view.secondaryText"
          ref="secondaryScrollRef"
          class="subtitles-secondary-scroll"
        >
          <p class="subtitles-secondary">
            {{ view.secondaryText }}
          </p>
        </div>
        <p
          v-if="!hasMainContent && !view.errorText"
          class="subtitles-secondary"
        >
          {{ view.placeholder }}
        </p>
      </div>
      <div ref="actions" class="subtitles-actions" @mousedown.stop>
        <IconButton
          size="sm"
          icon="mdi:arrow-expand"
          :label="view.expandLabel"
          @click="requestAction('expand')"
        />
      </div>
      <span
        v-if="!isAnchored"
        class="subtitles-grip"
        aria-hidden="true"
        @mousedown.left.stop.prevent="startResizing"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { desktopClient } from '../../lib/desktop/client'
import { invokeDesktop } from '../../lib/desktop/invoke'
import { getDesktopWindow } from '../../lib/desktop/window'
import { clientLogger } from '../../lib/logger'
import IconButton from '../common/IconButton.vue'
import {
  DESKTOP_EVENTS,
  type SubtitlesAction,
  type SubtitlesView,
} from '@tyco/shared'

const EMPTY_VIEW: SubtitlesView = {
  mainText: '',
  mainLang: null,
  pendingText: '',
  secondaryText: '',
  placeholder: '',
  errorText: '',
  isActive: false,
  stopLabel: '',
  expandLabel: '',
  recordingStartedAt: null,
  recordingLabel: '',
}

const ANCHORED_MAX_LINES_WITH_SECONDARY = 2
const ANCHORED_MAX_LINES_ALONE = 3

const view = ref<SubtitlesView>(EMPTY_VIEW)
/** Held at the bottom by the compositor: not moved, clicked through */
const isAnchored = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const subtitlesRef = ref<HTMLElement | null>(null)
const textRef = ref<HTMLElement | null>(null)
const errorRef = ref<HTMLElement | null>(null)
const actions = ref<HTMLElement | null>(null)
const mainScrollRef = ref<HTMLElement | null>(null)
const mainTextRef = ref<HTMLElement | null>(null)
const secondaryScrollRef = ref<HTMLElement | null>(null)
const mainMaxHeightPx = ref<number | null>(null)
let stopListening: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined

const trimmedPendingText = computed(() => view.value.pendingText.trim())
const hasMainContent = computed(() =>
  Boolean(view.value.mainText || trimmedPendingText.value)
)
const mainScrollStyle = computed(() =>
  mainMaxHeightPx.value !== null
    ? { maxHeight: `${mainMaxHeightPx.value}px` }
    : undefined
)

const logError = (message: string) => (error: unknown) =>
  clientLogger.error(message, error, 'dialog')

function scrollToBottom() {
  if (mainScrollRef.value) {
    mainScrollRef.value.scrollTop = mainScrollRef.value.scrollHeight
  }
  if (secondaryScrollRef.value) {
    secondaryScrollRef.value.scrollTop = secondaryScrollRef.value.scrollHeight
  }
}

/**
 * Quantizes the main scroll viewport to a whole number of rendered lines so a
 * larger UI scale, an error banner, or a manual resize never slices a line in
 * half horizontally.
 */
function updateMainMaxHeight() {
  const rootEl = rootRef.value
  const subtitlesEl = subtitlesRef.value
  const mainEl = mainTextRef.value
  if (!rootEl || !subtitlesEl || !mainEl) {
    mainMaxHeightPx.value = null
    return
  }

  const rootHeight = rootEl.clientHeight
  const lineHeight = Number.parseFloat(getComputedStyle(mainEl).lineHeight)
  if (!rootHeight || !Number.isFinite(lineHeight) || lineHeight <= 0) {
    mainMaxHeightPx.value = null
    return
  }

  const subtitlesStyle = getComputedStyle(subtitlesEl)
  const verticalChrome =
    (Number.parseFloat(subtitlesStyle.paddingTop) || 0) +
    (Number.parseFloat(subtitlesStyle.paddingBottom) || 0) +
    (Number.parseFloat(subtitlesStyle.borderTopWidth) || 0) +
    (Number.parseFloat(subtitlesStyle.borderBottomWidth) || 0)

  const textStyle = textRef.value ? getComputedStyle(textRef.value) : null
  const rowGap = textStyle ? Number.parseFloat(textStyle.rowGap) || 0 : 0

  let reservedHeight = verticalChrome
  let siblingCount = 0
  if (errorRef.value) {
    reservedHeight += errorRef.value.offsetHeight
    siblingCount += 1
  }
  if (secondaryScrollRef.value) {
    reservedHeight += secondaryScrollRef.value.offsetHeight
    siblingCount += 1
  }
  reservedHeight += siblingCount * rowGap

  const availableHeight = Math.max(0, rootHeight - reservedHeight)
  const fittingLines = Math.max(
    1,
    Math.floor((availableHeight + 0.5) / lineHeight)
  )
  const visibleLines = isAnchored.value
    ? Math.min(
        fittingLines,
        view.value.secondaryText
          ? ANCHORED_MAX_LINES_WITH_SECONDARY
          : ANCHORED_MAX_LINES_ALONE
      )
    : fittingLines

  mainMaxHeightPx.value = Math.round(visibleLines * lineHeight)
}

async function syncLayout() {
  await nextTick()
  updateMainMaxHeight()
  await nextTick()
  scrollToBottom()
}

/**
 * Only the buttons of an anchored strip take the pointer: the rest lets clicks
 * through to the call below it.
 */
async function updateInputRegion() {
  if (!isAnchored.value || !actions.value) return
  const rect = actions.value.getBoundingClientRect()
  await invokeDesktop('set_subtitles_input_region', {
    region: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
  }).catch(logError('Could not set the input region of the subtitles'))
}

function requestAction(action: SubtitlesAction) {
  void invokeDesktop('request_subtitles_action', { action }).catch(
    logError('Could not hand over a button of the subtitles')
  )
}

function startDragging(event: MouseEvent) {
  if (isAnchored.value) return
  if ((event.target as HTMLElement).closest('button')) return
  void getDesktopWindow()
    .startDragging()
    .catch(logError('Could not move the subtitles'))
}

function startResizing() {
  void getDesktopWindow()
    .startResizeDragging('SouthEast')
    .catch(logError('Could not resize the subtitles'))
}

watch(
  () => [
    view.value.mainText,
    view.value.pendingText,
    view.value.secondaryText,
    view.value.errorText,
    isAnchored.value,
  ],
  () => {
    void syncLayout()
  }
)

watch(
  () => view.value.isActive,
  async () => {
    await nextTick()
    await updateInputRegion()
  }
)

onMounted(async () => {
  stopListening = await desktopClient
    .listen(DESKTOP_EVENTS.SUBTITLES_CHANGED, (next) => {
      view.value = next
      void syncLayout()
    })
    .catch(() => undefined)
  try {
    const snapshot = await invokeDesktop('get_subtitles')
    isAnchored.value = snapshot.isAnchored
    if (snapshot.view) {
      view.value = snapshot.view
    }
  } catch (error) {
    logError('Could not read the subtitles')(error)
  }
  await syncLayout()
  await updateInputRegion()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      void updateInputRegion()
      void syncLayout()
    })
    if (rootRef.value) resizeObserver.observe(rootRef.value)
    if (subtitlesRef.value) resizeObserver.observe(subtitlesRef.value)
    if (actions.value) resizeObserver.observe(actions.value)
  }
})

onBeforeUnmount(() => {
  stopListening?.()
  resizeObserver?.disconnect()
})
</script>

<style>
/* the window is transparent around the rounded strip */
html,
body.subtitles-body {
  background: transparent;
  overflow: hidden;
  margin: 0;
  padding: 0;
  height: 100%;
}

#app {
  height: 100%;
}
</style>

<style scoped>
.subtitles-root {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.subtitles-root.is-anchored {
  justify-content: flex-end;
}

.subtitles {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 100%;
  min-height: 2.75rem;
  max-height: 100%;
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  background-color: color-mix(
    in oklab,
    var(--app-surface-raised) 94%,
    transparent
  );
  color: var(--color-base-content);
  cursor: grab;
  user-select: none;
  overflow: hidden;
}

.subtitles.is-anchored {
  height: auto;
  cursor: default;
}

:global([data-theme='eInk']) .subtitles {
  background-color: var(--app-surface-raised);
}

.subtitles-text {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.125rem;
  max-height: 100%;
  overflow: hidden;
}

.subtitles-main-scroll {
  --main-line-height: 1.35rem;
  display: block;
  flex: 0 1 auto;
  min-height: 0;
  max-height: calc(3 * var(--main-line-height));
  overflow: hidden;
}

.subtitles-main-scroll.has-secondary {
  max-height: calc(2 * var(--main-line-height));
}

.subtitles-main {
  font-size: var(--text-title, 1rem);
  font-weight: 500;
  line-height: var(--main-line-height, 1.35rem);
  margin: 0;
  overflow-wrap: anywhere;
}

.subtitles-pending {
  color: var(--app-text-faint);
}

.subtitles-error {
  flex-shrink: 0;
  font-size: var(--text-small, 0.8125rem);
  color: var(--color-error);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitles-secondary-scroll {
  --secondary-line-height: 1.15rem;
  display: block;
  flex-shrink: 0;
  max-height: var(--secondary-line-height);
  overflow: hidden;
}

.subtitles-secondary {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
  line-height: var(--secondary-line-height, 1.15rem);
  margin: 0;
  overflow-wrap: anywhere;
}

.subtitles-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-xs);
  cursor: default;
  flex-shrink: 0;
}

.subtitles-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 0.875rem;
  height: 0.875rem;
  cursor: nwse-resize;
}
</style>
