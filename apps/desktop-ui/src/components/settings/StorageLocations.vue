<template>
  <details class="storage-details">
    <summary class="storage-summary">
      {{ t('settings.storageLocations') }}
    </summary>
    <div v-if="!storageInfo" class="text-sm text-muted">
      {{ t('settings.storageLocationsUnavailable') }}
    </div>
    <div v-else class="storage-list">
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
            <button
              type="button"
              class="storage-copy-btn"
              :title="
                copiedStorageKey === item.key
                  ? t('settings.storagePathCopied')
                  : t('settings.storageCopyPath')
              "
              :aria-label="t('settings.storageCopyPath')"
              @click="copyStoragePath(item.value, item.key)"
            >
              <Icon
                :icon="
                  copiedStorageKey === item.key
                    ? 'mdi:check'
                    : 'mdi:content-copy'
                "
                height="14"
                class="shrink-0"
              />
            </button>
            <button
              type="button"
              class="storage-copy-btn"
              :title="t('settings.storageOpenFolder')"
              :aria-label="t('settings.storageOpenFolder')"
              @click="openStorageLocation(item.kind)"
            >
              <Icon
                icon="mdi:folder-open-outline"
                height="14"
                class="shrink-0"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useIpcStore } from '../../stores/ipc'
import { Icon } from '@iconify/vue'
import type { StorageInfo, StorageKind } from '@tyco/shared'

const { t } = useI18n()
const ipcStore = useIpcStore()
const storageInfo = ref<StorageInfo | null>(null)
const STORAGE_KIND_LABELS: Record<StorageKind, string> = {
  config: 'settings.storageConfig',
  data: 'settings.storageData',
  cache: 'settings.storageCache',
  logs: 'settings.storageLogs',
}

const copiedStorageKey = ref<string | null>(null)
let copyStorageTimeout: ReturnType<typeof setTimeout> | null = null

async function copyStoragePath(path: string, key: string) {
  try {
    await navigator.clipboard.writeText(path)
    copiedStorageKey.value = key
    if (copyStorageTimeout) {
      clearTimeout(copyStorageTimeout)
    }
    copyStorageTimeout = setTimeout(() => {
      copiedStorageKey.value = null
    }, 2000)
  } catch {
    // Clipboard access might be denied
  }
}

/** One row per root directory, named after everything it holds. */
const storageInfoItems = computed(() =>
  (storageInfo.value?.locations ?? []).map((location) => ({
    key: location.kinds.join('-'),
    kind: location.kinds[0],
    label: location.kinds
      .map((kind) => t(STORAGE_KIND_LABELS[kind]))
      .join(' · '),
    hint: location.kinds.includes('data')
      ? t('settings.storageDataHint')
      : undefined,
    value: location.path,
  }))
)

async function openStorageLocation(kind: StorageKind) {
  // a failure leaves nothing open, which tells enough
  await ipcStore.callFunction('openStorageLocation', [kind])
}

async function loadStorageInfo() {
  const result = await ipcStore.callFunction('getStorageInfo')
  storageInfo.value = result.success
    ? (result.result as StorageInfo | null) || null
    : null
}

onMounted(() => {
  void loadStorageInfo()
})
onUnmounted(() => {
  if (copyStorageTimeout) clearTimeout(copyStorageTimeout)
})
</script>
<style scoped>
.storage-details {
  margin-top: var(--space-2xl);
  padding: 0 var(--space-xs);
}

.storage-summary {
  font-size: var(--text-control);
  font-weight: 500;
  color: var(--app-text-muted);
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}

.storage-summary:hover {
  color: var(--color-base-content);
}

.storage-details > :not(summary) {
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
