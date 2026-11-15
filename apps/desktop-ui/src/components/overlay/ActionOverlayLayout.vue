<template>
  <div class="action-overlay-layout">
    <!-- Top row: framed text preview / diff / meta and unified header with Esc button -->
    <div class="action-overlay-top">
      <div
        v-if="title || $slots['header-extra'] || escVisible"
        class="action-overlay-header"
      >
        <div class="action-overlay-header-left">
          <h1 v-if="title" class="action-overlay-title">{{ title }}</h1>
          <div v-if="$slots['header-extra']" class="action-overlay-extra">
            <slot name="header-extra" />
          </div>
        </div>

        <div
          v-if="$slots['header-actions']"
          class="action-overlay-header-actions"
        >
          <slot name="header-actions" />
        </div>
        <Button
          v-if="canOpenOtherActions"
          size="sm"
          variant="ghost"
          @click="openOtherActions"
        >
          {{ t('menu.otherActions') }}
        </Button>
        <OverlayEscButton
          v-if="escVisible"
          :mode="resolvedEscMode"
          :label="escLabel"
          :title="
            resolvedEscMode === 'back' || props.escLabel
              ? escLabel
              : t('common.close')
          "
          @click="onEscClick"
          @close-all="handleCloseAll"
        />
        <OverlayCloseButton
          v-if="escVisible && resolvedEscMode === 'back' && inQuickWindow"
          :title="escTitle"
          @click="handleCloseAll"
        />
      </div>

      <div class="action-overlay-preview-box">
        <slot name="preview">
          <slot />
        </slot>
      </div>
    </div>

    <!-- Bottom row: fixed-height keyboard action block (5x3 grid + system keys) -->
    <div v-if="$slots['actions']" class="action-overlay-bottom">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from 'vue'

import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { isQuickWindow } from '../../lib/desktop/window'
import { previewAppearanceKey } from '../../lib/ui/preview-context'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import Button from '../common/Button.vue'
import OverlayCloseButton from './OverlayCloseButton.vue'
import OverlayEscButton from './OverlayEscButton.vue'

provide(previewAppearanceKey, 'plain')

// the main window closes by its own frame: no close cross there
const inQuickWindow = isQuickWindow()

const props = withDefaults(
  defineProps<{
    otherActionsText?: string
    title?: string
    escVisible?: boolean
    escMode?: 'close' | 'back' | 'auto'
    escLabel?: string
    onEsc?: () => void
  }>(),
  {
    otherActionsText: undefined,
    title: undefined,
    escVisible: true,
    escMode: 'auto',
    escLabel: undefined,
    onEsc: undefined,
  }
)

const {
  resolvedEscMode,
  escLabel,
  escTitle,
  handleEsc,
  handleCloseAll,
  isAtRoot,
} = useOverlayNav(() => ({
  escMode: props.escMode,
  escLabel: props.escLabel,
  onEsc: props.onEsc,
}))

const { t } = useI18n()
const menuModalsStore = useMenuModalsStore()
// Only a screen that explicitly supplies source text can switch scenarios.
// Inferring this from the shared stack leaks another screen's capabilities.
const canOpenOtherActions = computed(
  () =>
    isAtRoot() &&
    menuModalsStore.currentModal !== MenuModals.INSERT &&
    props.otherActionsText !== undefined
)
function openOtherActions() {
  const params = menuModalsStore.currentModalParams
  const text =
    props.otherActionsText ?? ('text' in params ? params.text : undefined)
  menuModalsStore.startScenario(MenuModals.INSERT, { text })
}

function onEscClick(event: MouseEvent) {
  if (event.shiftKey) {
    handleCloseAll()
  } else {
    if (resolvedEscMode.value === 'close' && !props.escLabel) handleCloseAll()
    else handleEsc()
  }
}

useDismissibleLayer({
  dismiss: handleEsc,
  isOpen: () => props.escVisible,
  elements: () => [],
  canDismissOutside: false,
  keyboardPhase: 'bubble',
  keydown: (event) => {
    if (event.key !== 'Escape') return
    // Ctrl+Q never gets here: `useCloseWindowStore` owns it
    if (!props.escLabel && resolvedEscMode.value === 'close') handleCloseAll()
    else handleEsc()
  },
})
</script>

<style scoped>
.action-overlay-layout {
  --key-size: var(--quick-kbd-size);
  --key-font-size: var(--quick-kbd-font-size);
  --key-background: var(--quick-kbd-bg);
  --key-border-color: var(--quick-kbd-border);
  --key-color: var(--quick-kbd-color);
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--quick-gap);
  width: 100%;
  height: 100%;
  flex: 1 1 0%;
  min-height: 0;
  box-sizing: border-box;
}

.action-overlay-top {
  display: flex;
  flex-direction: column;
  gap: var(--quick-section-gap);
  flex: 1 1 0%;
  min-height: 0;
}

.action-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-shrink: 0;
  min-height: var(--control-size-sm);
}

.action-overlay-header-left {
  display: flex;
  flex-wrap: wrap;
  flex: 1;
  align-items: center;
  gap: var(--space-md);
  min-width: 0;
}

.action-overlay-title {
  flex-shrink: 0;
  margin: 0;
  font-size: var(--quick-title-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-base-content);
  line-height: 1.25;
}

.action-overlay-extra {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-control);
}

.action-overlay-preview-box {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  border: 1px solid var(--quick-field-border);
  border-radius: var(--quick-radius);
  background-color: var(--quick-field-bg);
  overflow: hidden;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.action-overlay-preview-box:has(:is(textarea, [contenteditable]):focus) {
  border-color: var(--quick-field-border-focus);
  box-shadow: var(--app-focus-ring);
}

/* The box shows the text field's focus, so the field draws no second ring */
.action-overlay-preview-box :deep(:is(textarea, [contenteditable]):focus) {
  outline: none;
}

.action-overlay-bottom {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
</style>
