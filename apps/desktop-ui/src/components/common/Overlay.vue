<template>
  <!-- The overlay is dark: it is a keyboard HUD on top of the app, not a page
       of it. E-ink keeps its own flat palette instead. -->
  <div class="overlay" :data-theme="overlayTheme">
    <div class="overlay-panel" :class="{ 'is-compact': !navBarVisible }">
      <button
        v-if="navBarVisible"
        type="button"
        class="overlay-back"
        @click="menuModalsStore.back"
      >
        <KeyButton>Esc</KeyButton>
        <span>{{ t('common.back') }}</span>
      </button>
      <div class="overlay-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useThemeStore } from '../../stores/theme'
import KeyButton from './KeyButton.vue'

const menuModalsStore = useMenuModalsStore()
const themeStore = useThemeStore()
const overlayTheme = computed(() =>
  themeStore.resolved.theme === 'e-ink' ? 'e-ink' : 'dark'
)
const { t } = useI18n()
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
  padding: var(--space-lg);
  background-color: var(--app-overlay-bg);
  backdrop-filter: var(--app-overlay-backdrop);
  color: var(--color-base-content);
  animation: overlay-in 140ms ease-out;
}

:global([data-window='quick'] .overlay) {
  inset: var(--space-sm);
  background-color: var(--app-overlay-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
  padding: var(--space-sm);
  overflow: hidden;
}

.overlay-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 920px;
  min-height: 0;
  margin: 0 auto;
  padding: var(--space-md) var(--space-lg);
  border: none;
  border-radius: 0;
  background-color: transparent;
  box-shadow: none;
}

.overlay-panel.is-compact {
  align-self: center;
  max-width: 360px;
  padding: var(--space-2xl);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  background-color: color-mix(in oklab, var(--color-base-100) 94%, transparent);
}

.overlay-back {
  position: absolute;
  top: var(--space-md);
  right: var(--space-md);
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.25rem 0.5rem 0.25rem 0.25rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  color: var(--app-text-muted);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.overlay-back:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.overlay-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* keep menu titles clear of the back button */
.overlay-body :deep(h1) {
  padding-right: 7rem;
}

.overlay-body :deep(.action-overlay-header h1) {
  padding-right: 0;
}

@keyframes overlay-in {
  from {
    opacity: 0;
  }
}
</style>
