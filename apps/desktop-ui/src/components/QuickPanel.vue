<template>
  <ContentPadding>
    <Editor v-if="ipcStore.params">
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
  </ContentPadding>
</template>

<script setup lang="ts">
/**
 * Quick input panel. Unlike the routed views it stays mounted for the whole
 * lifetime of the app and is only toggled with `v-show`, so the input field and
 * its focus survive between hotkey activations. Activation side effects live in
 * `useQuickPanelStore`, because there is no mount to hang them on.
 */
import { useI18n } from '../composables/useI18n'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useIpcStore } from '../stores/ipc'
import { Icon } from '@iconify/vue'

const ipcStore = useIpcStore()
const { t } = useI18n()
</script>

<style scoped>
.mode-links {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--app-border-subtle);
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
