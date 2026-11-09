<template>
  <!-- only a press on the grip moves the window: buttons and text stay usable -->
  <div
    v-if="desktopStore.desktopState.canMoveOverlay"
    class="overlay-drag-handle"
    role="button"
    :aria-label="t('window.moveOverlay')"
    :title="t('window.moveOverlay')"
    @mousedown.left.prevent="startDragging"
  >
    <AppIcon icon="mdi:drag-horizontal-variant" />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { getDesktopWindow } from '../../lib/desktop/window'
import { clientLogger } from '../../lib/logger'
import { useDesktopStore } from '../../stores/desktop'
import AppIcon from '../common/AppIcon.vue'

const desktopStore = useDesktopStore()
const { t } = useI18n()

/** The platform moves the window itself, see `canMoveOverlay` */
function startDragging() {
  void getDesktopWindow()
    .startDragging()
    .catch((error: unknown) =>
      clientLogger.error('Could not move the overlay', error, 'quick')
    )
}
</script>

<style scoped>
.overlay-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-sm);
  color: var(--app-text-faint);
  cursor: grab;
  opacity: 0.7;
}

.overlay-drag-handle:hover {
  color: var(--color-base-content);
  opacity: 1;
}

.overlay-drag-handle:active {
  cursor: grabbing;
}
</style>
