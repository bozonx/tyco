<template>
  <SettingsSection :title="t('settings.userData.title')">
    <template #info>
      <InfoTooltip :text="sectionInfo" panel-class="panel-wide" />
    </template>

    <div class="user-data">
      <PathDisplay :path="userData.path" can-open @open="open">
        <template #actions>
          <Button
            size="sm"
            icon="mdi:folder-search-outline"
            :loading="folder.isBusy.value"
            @click="folder.start('choose')"
          >
            {{ t('common.change') }}
          </Button>
        </template>
      </PathDisplay>

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
import InfoTooltip from '../common/InfoTooltip.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'
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
</style>
