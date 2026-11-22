<template>
  <div
    class="subtitles"
    :class="{ 'is-anchored': isAnchored }"
    @mousedown.left="startDragging"
  >
    <div class="subtitles-text" aria-live="polite">
      <p
        v-if="view.errorText"
        class="subtitles-error"
        role="alert"
        :title="view.errorText"
      >
        {{ view.errorText }}
      </p>
      <p v-if="view.mainText" class="subtitles-main">
        <span :lang="view.mainLang ?? undefined">{{ view.mainText }}</span>
        <span v-if="view.pendingText" class="subtitles-pending">
          {{ view.pendingText }}</span
        >
      </p>
      <p v-if="view.secondaryText" class="subtitles-secondary">
        {{ view.secondaryText }}
      </p>
      <p v-if="!view.mainText && !view.errorText" class="subtitles-secondary">
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
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

const view = ref<SubtitlesView>(EMPTY_VIEW)
/** Held at the bottom by the compositor: not moved, clicked through */
const isAnchored = ref(false)
const actions = ref<HTMLElement | null>(null)
let stopListening: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined

const logError = (message: string) => (error: unknown) =>
  clientLogger.error(message, error, 'dialog')

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
    })
    .catch(() => undefined)
  try {
    const snapshot = await invokeDesktop('get_subtitles')
    isAnchored.value = snapshot.isAnchored
    if (snapshot.view) view.value = snapshot.view
  } catch (error) {
    logError('Could not read the subtitles')(error)
  }
  await nextTick()
  await updateInputRegion()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => void updateInputRegion())
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
}
</style>

<style scoped>
.subtitles {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 100dvh;
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
  cursor: default;
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

.subtitles-main {
  font-size: 1.125rem;
  font-weight: 500;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.subtitles-pending {
  color: var(--app-text-faint);
}

.subtitles-error {
  font-size: var(--text-small, 0.8125rem);
  color: var(--color-error);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitles-secondary {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
