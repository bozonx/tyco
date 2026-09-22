<template>
  <div ref="panelRef" class="quick-panel">
    <div v-if="ipcStore.params" class="quick-input-shell">
      <EditorInput class="quick-input" />
      <Button
        sm
        square
        ghost
        class="clear-button"
        :title="t('editor.clear')"
        @click="clear"
      >
        <Icon icon="mdi:eraser" height="18" />
      </Button>
    </div>
    <footer class="quick-footer">
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
      <span class="quick-hint">Esc · {{ t('nav.actions') }}</span>
    </footer>
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
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useQuickPanelStore } from '../stores/quickPanel'
import { Icon } from '@iconify/vue'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'

const ipcStore = useIpcStore()
const editorInputStore = useEditorInputStore()
const quickPanelStore = useQuickPanelStore()
const panelRef = ref<HTMLElement | null>(null)
const { t } = useI18n()
let resizeObserver: ResizeObserver | null = null
let lastWindowHeight = 0

const resizeWindow = async (): Promise<void> => {
  if (!quickPanelStore.isActive || !panelRef.value) return

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

const clear = (): void => {
  editorInputStore.clear()
  editorInputStore.focus()
}
</script>

<style scoped>
.quick-panel {
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

.quick-input-shell {
  display: flex;
  align-items: flex-end;
  min-height: 3.25rem;
  overflow: hidden;
}

.quick-input {
  flex: 1;
  min-width: 0;
  height: auto;
  max-height: 13rem;
}

.quick-panel :deep(.quick-input.main-input),
.quick-input :deep(.cm-editor) {
  height: auto;
}

.quick-input :deep(.cm-scroller) {
  max-height: 13rem;
  overflow-y: auto;
}

.quick-input :deep(.cm-content) {
  min-height: calc(var(--editor-line-height) * 1em);
  padding: 0.625rem 0.75rem;
}

.clear-button {
  flex: 0 0 auto;
  margin: 0.375rem;
  color: var(--app-text-muted);
}

.quick-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 1.75rem;
  padding: 0 var(--space-xs);
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

.quick-hint {
  flex: 0 0 auto;
  font-size: 0.7rem;
  color: var(--app-text-faint);
}

.mode-link:hover {
  opacity: 1;
  color: var(--color-base-content);
  background-color: var(--app-hover);
}
</style>
