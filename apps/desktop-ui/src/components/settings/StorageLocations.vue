<template>
  <section class="storage-details">
    <DisclosureHeader
      class="storage-summary"
      density="compact"
      :expanded="isOpen"
      :controls="bodyId"
      :title="t('settings.storageLocations')"
      @toggle="isOpen = !isOpen"
    />
    <StateMessage
      v-if="isOpen && !storageInfo"
      :id="bodyId"
      density="compact"
      :message="t('settings.storageLocationsUnavailable')"
    />
    <div v-else-if="isOpen" :id="bodyId" class="storage-list">
      <div
        v-for="item in storageInfoItems"
        :key="item.key"
        class="storage-item"
      >
        <span class="storage-item-label">
          {{ item.label }}
          <span v-if="item.hint" class="storage-item-hint">{{
            item.hint
          }}</span>
        </span>
        <div class="storage-path-box">
          <code class="storage-path" :title="item.value">{{ item.value }}</code>
          <div class="storage-path-actions">
            <CopyButton
              class="storage-copy-btn"
              :value="item.value"
              :label="t('settings.storageCopyPath')"
              :copied-label="t('settings.storagePathCopied')"
            />
            <IconButton
              class="storage-copy-btn"
              @click="openStorageLocation(item.kind)"
              :label="t('settings.storageOpenFolder')"
              icon="mdi:folder-open-outline"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useIpcStore } from '../../stores/ipc'
import CopyButton from '../common/CopyButton.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import IconButton from '../common/IconButton.vue'
import StateMessage from '../common/StateMessage.vue'
import type { StorageInfo, StorageKind } from '@tyco/shared'

const { t } = useI18n()
const props = defineProps<{ isInDevelopment?: boolean }>()
const ipcStore = useIpcStore()
const storageInfo = ref<StorageInfo | null>(null)
const STORAGE_KIND_LABELS: Record<StorageKind, string> = {
  config: 'settings.storageConfig',
  data: 'settings.storageData',
  cache: 'settings.storageCache',
  logs: 'settings.storageLogs',
}

const isOpen = ref(false)
const bodyId = useId()

/** One row per root directory, named after everything it holds. */
const storageInfoItems = computed(() =>
  (storageInfo.value?.locations ?? []).map((location) => ({
    key: location.kinds.join('-'),
    kind: location.kinds[0],
    label: location.kinds
      .map((kind) => t(STORAGE_KIND_LABELS[kind]))
      .join(' · '),
    hint:
      location.kinds.includes('data') && props.isInDevelopment
        ? t('settings.storageDataHint')
        : undefined,
    value: location.path,
  }))
)

async function openStorageLocation(kind: StorageKind) {
  // a failure leaves nothing open, which tells enough
  await ipcStore.call('open_storage_location', { kind })
}

async function loadStorageInfo() {
  const result = await ipcStore.call('get_storage_info')
  storageInfo.value = result.success
    ? (result.result as StorageInfo | null) || null
    : null
}

onMounted(() => {
  void loadStorageInfo()
})
</script>
<style scoped>
.storage-details {
  margin-top: var(--space-2xl);
  padding: 0 var(--space-xs);
}

.storage-summary {
  font-size: var(--text-control);
  color: var(--app-text-muted);
  transition: color var(--transition-fast);
}

.storage-summary:hover {
  color: var(--color-base-content);
}

.storage-details > :not(.storage-summary) {
  margin-top: var(--space-md);
}

.storage-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.storage-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.storage-item-label {
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--app-text-muted);
}

.storage-item-hint {
  display: block;
  font-weight: 400;
  color: var(--app-text-muted);
}

.storage-path-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0.375rem 0.5rem 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  min-width: 0;
}

.storage-path {
  flex: 1 1 auto;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  color: var(--color-base-content);
  word-break: break-all;
  user-select: all;
  min-width: 0;
}

.storage-path-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}

.storage-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  opacity: 0.8;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.storage-copy-btn:hover,
.storage-copy-btn:focus-visible {
  opacity: 1;
  background-color: var(--app-hover);
  color: var(--color-base-content);
}

.storage-copy-btn:focus-visible {
  box-shadow: var(--app-focus-ring);
}
</style>
