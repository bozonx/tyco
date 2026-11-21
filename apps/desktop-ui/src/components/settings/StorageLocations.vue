<template>
  <section class="storage-details">
    <div class="storage-header">
      <DisclosureHeader
        class="storage-summary"
        density="compact"
        :expanded="isOpen"
        :controls="bodyId"
        :title="t('settings.storageLocations')"
        @toggle="isOpen = !isOpen"
      />
      <InfoTooltip
        :text="t('settings.storageLocationsInfo')"
        panel-class="panel-wide"
      />
    </div>
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
        <span class="storage-item-label">{{ item.label }}</span>
        <PathDisplay
          :path="item.value"
          can-open
          @open="openStorageLocation(item.kind)"
        />
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useIpcStore } from '../../stores/ipc'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import PathDisplay from '../common/PathDisplay.vue'
import StateMessage from '../common/StateMessage.vue'
import type { StorageInfo, StorageKind } from '@tyco/shared'

const { t } = useI18n()
const ipcStore = useIpcStore()
const storageInfo = ref<StorageInfo | null>(null)
const STORAGE_KIND_LABELS: Record<StorageKind, string> = {
  user: 'settings.userData.title',
  device: 'settings.storageDevice',
  state: 'settings.storageState',
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

.storage-header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  max-width: 100%;
}

.storage-summary {
  flex: 0 1 auto;
  font-size: var(--text-control);
  color: var(--app-text-muted);
  transition: color var(--transition-fast);
}

.storage-summary:hover {
  color: var(--color-base-content);
}

.storage-details > :not(.storage-header) {
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
</style>
