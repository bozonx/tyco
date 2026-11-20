<template>
  <div class="dialog-subtitles" @mousedown.left="startDragging">
    <div class="dialog-subtitles-text" aria-live="polite">
      <template v-if="turn">
        <p v-if="mainText" class="dialog-subtitles-main" :lang="mainLang">
          {{ mainText }}
        </p>
        <p v-if="secondaryText" class="dialog-subtitles-secondary">
          {{ secondaryText }}
        </p>
      </template>
      <p v-else class="dialog-subtitles-secondary">{{ placeholder }}</p>
    </div>
    <div class="dialog-subtitles-actions" @mousedown.stop>
      <IconButton
        v-if="dialog.isActive"
        icon="mdi:stop"
        :label="t('dialog.stop')"
        @click="dialog.stop()"
      />
      <IconButton
        icon="mdi:arrow-expand"
        :label="t('dialog.expand')"
        @click="dialog.leaveCompact()"
      />
    </div>
    <span
      class="dialog-subtitles-grip"
      aria-hidden="true"
      @mousedown.left.stop.prevent="startResizing"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { getDesktopWindow } from '../../lib/desktop/window'
import {
  lastRemoteTurn,
  turnText,
  turnTranslation,
} from '../../lib/dialog/dialog-transcript'
import { clientLogger } from '../../lib/logger'
import { useDialogStore } from '../../stores/dialog'
import IconButton from '../common/IconButton.vue'

const dialog = useDialogStore()
const { t } = useI18n()

const turn = computed(() => lastRemoteTurn(dialog.turns))
const original = computed(() => (turn.value ? turnText(turn.value) : ''))
const translation = computed(() =>
  turn.value && dialog.config.translationTargetLanguage
    ? turnTranslation(turn.value)
    : ''
)
const display = computed(() => dialog.config.textDisplay)
// the translation large and the original small under it
const mainText = computed(() =>
  display.value === 'original' || !translation.value
    ? original.value
    : translation.value
)
const mainLang = computed(() =>
  mainText.value === translation.value
    ? dialog.config.translationTargetLanguage
    : undefined
)
const secondaryText = computed(() =>
  display.value === 'both' && translation.value ? original.value : ''
)
const placeholder = computed(() =>
  dialog.isActive ? t('dialog.waitingForSpeech') : t('dialog.notRunning')
)

function startDragging(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('button')) return
  void getDesktopWindow()
    .startDragging()
    .catch((error: unknown) =>
      clientLogger.error('Could not move the subtitles', error, 'dialog')
    )
}

function startResizing() {
  void getDesktopWindow()
    .startResizeDragging('SouthEast')
    .catch((error: unknown) =>
      clientLogger.error('Could not resize the subtitles', error, 'dialog')
    )
}
</script>

<style scoped>
.dialog-subtitles {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  height: 100dvh;
  padding: var(--space-sm) var(--space-md);
  background-color: var(--app-surface-raised);
  cursor: grab;
  user-select: none;
  overflow: hidden;
}

.dialog-subtitles-text {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.125rem;
  max-height: 100%;
  overflow: hidden;
}

.dialog-subtitles-main {
  font-size: 1.375rem;
  font-weight: 500;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dialog-subtitles-secondary {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dialog-subtitles-actions {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  cursor: default;
}

.dialog-subtitles-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 0.875rem;
  height: 0.875rem;
  cursor: nwse-resize;
}
</style>
