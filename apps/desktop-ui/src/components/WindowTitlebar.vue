<template>
  <header class="window-titlebar" data-tauri-drag-region>
    <span class="window-title" data-tauri-drag-region>{{ title }}</span>
    <Button
      square
      ghost
      class="window-close"
      icon="mdi:close"
      :title="t('window.close')"
      :aria-label="t('window.close')"
      @click="close"
    />
  </header>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { useIpcStore } from '../stores/ipc'
import Button from './common/Button.vue'

defineProps<{ title: string }>()

const { t } = useI18n()
const ipcStore = useIpcStore()

function close() {
  void ipcStore.callFunction('closeWindow')
}
</script>

<style scoped>
.window-titlebar {
  display: flex;
  flex: 0 0 2.5rem;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding-left: var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--app-surface-raised);
  user-select: none;
}

.window-title {
  overflow: hidden;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--app-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-close {
  align-self: stretch;
  width: 2.75rem;
  border-radius: 0;
}
</style>
