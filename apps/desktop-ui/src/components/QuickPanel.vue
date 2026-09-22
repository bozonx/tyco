<template>
  <div
    ref="panelRef"
    class="quick-panel"
    :class="{ 'is-compact': ipcStore.params.quickInput }"
  >
    <Editor v-if="ipcStore.params" :compact="ipcStore.params.quickInput">
      <nav class="mode-links">
        <RouterLink :to="APP_ROUTES.WRITE.path" class="mode-link">
          <Icon icon="mdi:text-box-edit-outline" height="14" />
          {{ t('mode.write') }}
        </RouterLink>
        <RouterLink :to="APP_ROUTES.VOICE.path" class="mode-link">
          <Icon icon="mdi:microphone-outline" height="14" />
          {{ t('mode.voice') }}
        </RouterLink>
        <RouterLink :to="APP_ROUTES.AI_TASKS.path" class="mode-link">
          <Icon icon="mdi:robot-outline" height="14" />
          {{ t('mode.aiTasks') }}
        </RouterLink>
        <RouterLink :to="APP_ROUTES.SELECT.path" class="mode-link">
          <Icon icon="mdi:cursor-text" height="14" />
          {{ t('mode.select') }}
        </RouterLink>
      </nav>
    </Editor>
  </div>
</template>

<script setup lang="ts">
/**
 * Quick input panel. Unlike the routed views it stays mounted for the whole
 * lifetime of the app and is only toggled with `v-show`, so the input field and
 * its focus survive between hotkey activations. Activation side effects live in
 * `useQuickPanelStore`, because there is no mount to hang them on.
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { APP_ROUTES } from '../lib/navigation/routes'
import {
  QUICK_PANEL_WIDTH,
  quickPanelWindowHeight,
} from '../lib/quick-panel/quick-panel-size'
import { useIpcStore } from '../stores/ipc'
import { useQuickPanelStore } from '../stores/quickPanel'
import { Icon } from '@iconify/vue'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'

const ipcStore = useIpcStore()
const quickPanelStore = useQuickPanelStore()
const panelRef = ref<HTMLElement | null>(null)
const { t } = useI18n()
let resizeObserver: ResizeObserver | null = null
let lastWindowHeight = 0

const resizeWindow = async (): Promise<void> => {
  if (
    !quickPanelStore.isActive ||
    !ipcStore.params.quickInput ||
    !panelRef.value
  )
    return

  const height = quickPanelWindowHeight(
    panelRef.value.getBoundingClientRect().height
  )
  if (height === lastWindowHeight) return

  try {
    await getCurrentWindow().setSize(new LogicalSize(QUICK_PANEL_WIDTH, height))
    lastWindowHeight = height
  } catch {
    // Browser development has no desktop window to resize.
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => void resizeWindow())
  if (panelRef.value) resizeObserver.observe(panelRef.value)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(
  () => quickPanelStore.isActive,
  async (isActive) => {
    if (!isActive) return
    await nextTick()
    void resizeWindow()
  }
)
</script>

<style scoped>
.quick-panel {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: var(--space-lg) var(--space-xl);
}

.quick-panel.is-compact {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: min(52rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 1rem);
  margin: 0 auto;
  padding: var(--space-sm);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--app-surface) 94%, transparent);
  box-shadow: var(--app-shadow-lg);
  backdrop-filter: blur(16px);
}

.is-compact :deep(.main-input),
.is-compact :deep(.cm-editor) {
  height: auto;
}

.is-compact :deep(.cm-scroller) {
  max-height: 13rem;
  overflow-y: auto;
}

.is-compact :deep(.cm-content) {
  min-height: calc(var(--editor-line-height) * 1em);
  padding: 0.625rem 0.75rem;
}

.mode-links {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-xs);
}

.mode-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--app-text-muted);
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.mode-link:hover {
  opacity: 1;
  color: var(--color-base-content);
  background-color: var(--app-hover);
}
</style>
