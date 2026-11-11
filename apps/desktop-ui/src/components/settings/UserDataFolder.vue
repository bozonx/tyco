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
        <div class="user-data-path-actions">
          <CopyButton
            :value="userData.path"
            :label="t('settings.storageCopyPath')"
            :copied-label="t('settings.storagePathCopied')"
          />
          <Button
            size="sm"
            variant="ghost"
            icon="mdi:folder-open-outline"
            @click="open"
          >
            {{ t('common.open') }}
          </Button>
          <Button
            size="sm"
            icon="mdi:folder-search-outline"
            :loading="folder.isBusy.value"
            @click="folder.start('choose')"
          >
            {{ t('common.change') }}
          </Button>
        </div>
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
    </div>

    <UserDataRelocationModal :model="folder" :current-path="userData.path" />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useUserDataFolder } from '../../composables/use-user-data-folder'
import { useSettingsSessionStore } from '../../stores/settings-session'
import { useUserDataStore } from '../../stores/user-data'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsSection from './SettingsSection.vue'
import UserDataRelocationModal from './UserDataRelocationModal.vue'

const { t } = useI18n()
const store = useUserDataStore()
const userData = computed(() => store.state())
const settingsSession = useSettingsSessionStore()
const folder = useUserDataFolder(() => settingsSession.flushAll())

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
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0.375rem 0.5rem 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  min-width: 0;
}

.user-data-path {
  flex: 1 1 12rem;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  word-break: break-all;
  user-select: all;
}

.user-data-path-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}
</style>
