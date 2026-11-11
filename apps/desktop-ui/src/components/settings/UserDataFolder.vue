<template>
  <SettingsSection :title="t('settings.userData.title')">
    <template #info>
      <InfoTooltip :text="sectionInfo" panel-class="panel-wide" />
    </template>

    <div class="user-data">
      <div class="user-data-path-box">
        <code class="user-data-path" :title="userData.path">{{
          userData.path
        }}</code>
        <Badge v-if="userData.isDefault" tone="muted">{{
          t('settings.userData.default')
        }}</Badge>
        <CopyButton
          :value="userData.path"
          :label="t('settings.storageCopyPath')"
          :copied-label="t('settings.storagePathCopied')"
        />
        <IconButton
          :label="t('settings.userData.open')"
          icon="mdi:folder-open-outline"
          @click="open"
        />
      </div>

      <InlineNotice
        v-if="userData.status === 'newerFormat'"
        density="compact"
        kind="error"
        :message="t('settings.userData.readOnly')"
      />
      <InlineNotice
        v-if="userData.isWritableByOthers"
        density="compact"
        kind="warning"
        :message="t('settings.userData.writableByOthers')"
      />

      <div class="user-data-actions">
        <Button
          size="sm"
          icon="mdi:folder-search-outline"
          :loading="folder.isBusy.value"
          @click="folder.start('choose')"
        >
          {{ t('settings.selectFolder') }}
        </Button>
      </div>
    </div>

    <SettingsAdvancedFields v-model:expanded="isAdvancedOpen">
      <div class="user-data-advanced">
        <DeviceHistoryJournals v-if="isAdvancedOpen" />
      </div>
    </SettingsAdvancedFields>

    <UserDataRelocationModal :model="folder" :current-path="userData.path" />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useUserDataFolder } from '../../composables/use-user-data-folder'
import { useSettingsSessionStore } from '../../stores/settings-session'
import { useUserDataStore } from '../../stores/user-data'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import InlineNotice from '../common/InlineNotice.vue'
import DeviceHistoryJournals from './DeviceHistoryJournals.vue'
import SettingsAdvancedFields from './SettingsAdvancedFields.vue'
import SettingsSection from './SettingsSection.vue'
import UserDataRelocationModal from './UserDataRelocationModal.vue'

const { t } = useI18n()
const store = useUserDataStore()
const userData = computed(() => store.state())
const settingsSession = useSettingsSessionStore()
const folder = useUserDataFolder(() => settingsSession.flushAll())
const isAdvancedOpen = ref(false)

const sectionInfo = computed(() =>
  t('settings.userData.info', {
    defaultPath: userData.value.defaultPath || '—',
  })
)

async function open() {
  // a failure leaves nothing open, which tells enough
  await store.open().catch(() => undefined)
}
</script>

<style scoped>
.user-data {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
}

.user-data-path-box {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.375rem 0.5rem 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  min-width: 0;
}

.user-data-path {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  word-break: break-all;
  user-select: all;
}

.user-data-advanced {
  padding: 0 var(--space-lg) var(--space-md);
}

.user-data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
</style>
