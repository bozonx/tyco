<template>
  <!-- The overlay is dark: it is a keyboard HUD on top of the app, not a page
       of it. E-ink keeps its own flat palette instead. -->
  <div
    class="overlay"
    :class="{ 'is-compact': !navBarVisible }"
    :data-theme="overlayTheme"
  >
    <div class="overlay-panel" :class="{ 'is-compact': !navBarVisible }">
      <div class="overlay-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useThemeStore } from '../../stores/theme'

const themeStore = useThemeStore()
const overlayTheme = computed(() =>
  themeStore.resolved.theme === 'eInk' ? 'eInk' : 'dark'
)
withDefaults(defineProps<{ navBarVisible?: boolean }>(), {
  navBarVisible: true,
})
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  padding: var(--space-sm);
  background-color: var(--app-overlay-bg);
  backdrop-filter: var(--app-overlay-backdrop);
  color: var(--color-base-content);
  animation: overlay-in 140ms ease-out;
}

:global([data-window='quick'] .overlay) {
  inset: var(--space-xs);
  background-color: var(--color-base-100);
  backdrop-filter: none;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: none;
  padding: var(--space-xs);
  overflow: hidden;
}

:global([data-window='quick'] .overlay:has(.overlay-panel.is-compact)) {
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  inset: 0;
  padding: 0;
  justify-content: center;
  align-items: center;
}

/* A compact overlay is a blocking status card: the dim keeps the text under
   it readable, so no blur. */
.overlay.is-compact,
:global([data-window='quick'] .overlay.is-compact) {
  background-color: var(--app-overlay-dim) !important;
  backdrop-filter: none;
  cursor: progress;
}

.overlay-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  border-radius: 0;
  background-color: transparent;
  box-shadow: none;
}

.overlay-panel.is-compact {
  align-self: center;
  min-width: min(280px, 100%);
  max-width: 360px;
  padding: var(--space-lg) var(--space-xl);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-xl);
  background-color: var(--app-surface-raised);
  box-shadow: var(--app-shadow-overlay);
  cursor: default;
  animation: panel-in 160ms ease-out;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
}

.overlay-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

@keyframes overlay-in {
  from {
    opacity: 0;
  }
}
</style>
