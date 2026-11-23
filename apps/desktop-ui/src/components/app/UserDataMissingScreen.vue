<template>
  <main class="user-data-missing" :aria-labelledby="titleId">
    <div v-if="isFirstStart" class="user-data-missing-card surface">
      <AppIcon icon="mdi:folder-sync-outline" size="3xl" class="text-muted" />
      <h1 :id="titleId" class="user-data-missing-title">
        {{ t('userDataSetup.title') }}
      </h1>
      <p class="user-data-missing-text">
        {{ t('userDataSetup.description') }}
      </p>

      <div class="user-data-setup-options">
        <div class="user-data-setup-option">
          <strong class="user-data-setup-option-title">
            {{ t('userDataSetup.existingTitle') }}
          </strong>
          <p class="user-data-missing-text">
            {{ t('userDataSetup.existingDescription') }}
          </p>
        </div>
        <div class="user-data-setup-option">
          <strong class="user-data-setup-option-title">
            {{ t('userDataSetup.freshTitle') }}
          </strong>
          <p class="user-data-missing-text">
            {{ t('userDataSetup.freshDescription') }}
          </p>
          <code class="user-data-missing-path">{{ userData.defaultPath }}</code>
        </div>
      </div>

      <InlineNotice
        v-if="errorMessage"
        density="compact"
        kind="error"
        announcement="polite"
        :message="errorMessage"
      />

      <div class="user-data-missing-actions">
        <Button
          size="sm"
          variant="primary"
          icon="mdi:folder-search-outline"
          :disabled="folder.isBusy.value"
          @click="folder.start('connect')"
        >
          {{ t('userDataSetup.selectFolder') }}
        </Button>
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:plus-circle-outline"
          :disabled="folder.isBusy.value"
          @click="useDefault"
        >
          {{ t('userDataSetup.startFresh') }}
        </Button>
      </div>
    </div>
    <div v-else class="user-data-missing-card surface">
      <AppIcon icon="mdi:folder-alert-outline" size="3xl" class="text-muted" />
      <h1 :id="titleId" class="user-data-missing-title">
        {{ t('userDataMissing.title') }}
      </h1>
      <p class="user-data-missing-text">
        {{ t('userDataMissing.description') }}
      </p>
      <code class="user-data-missing-path">{{ userData.path }}</code>

      <InlineNotice
        v-if="isAvailable"
        density="compact"
        kind="info"
        announcement="polite"
        :message="t('settings.userData.restartNotice')"
      />
      <InlineNotice
        v-if="isConfirmingDefault"
        density="compact"
        appearance="surface"
        kind="warning"
        :message="
          t('userDataMissing.useDefaultConfirm', { path: userData.defaultPath })
        "
      />
      <InlineNotice
        v-if="errorMessage"
        density="compact"
        kind="error"
        announcement="polite"
        :message="errorMessage"
      />

      <div class="user-data-missing-actions">
        <template v-if="isConfirmingDefault">
          <Button
            size="sm"
            variant="ghost"
            @click="isConfirmingDefault = false"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" variant="primary" @click="useDefault">
            {{ t('userDataMissing.useDefault') }}
          </Button>
        </template>
        <template v-else>
          <Button size="sm" variant="primary" icon="mdi:refresh" @click="retry">
            {{ t('userDataMissing.retry') }}
          </Button>
          <Button
            size="sm"
            icon="mdi:folder-sync-outline"
            @click="folder.start('connect')"
          >
            {{ t('userDataMissing.connectOther') }}
          </Button>
          <Button size="sm" variant="ghost" @click="isConfirmingDefault = true">
            {{ t('userDataMissing.useDefault') }}
          </Button>
        </template>
      </div>
    </div>
    <UserDataRelocationModal
      :model="folder"
      :current-path="isFirstStart ? undefined : userData.path"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useUserDataFolder } from '../../composables/use-user-data-folder'
import { desktopClient } from '../../lib/desktop/client'
import { describeError } from '../../lib/errors/describe-error'
import { translate } from '../../lib/i18n'
import { useUserDataStore } from '../../stores/user-data'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import InlineNotice from '../common/InlineNotice.vue'
import UserDataRelocationModal from '../settings/UserDataRelocationModal.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

const { t } = useI18n()
const titleId = useId()
const store = useUserDataStore()
const userData = computed(() => store.state())
const isFirstStart = computed(() => userData.value.status === 'notInitialized')
// nothing can be saved while the folder is missing or not initialized yet
const folder = useUserDataFolder(() => Promise.resolve(true))
const isConfirmingDefault = ref(false)
const errorMessage = ref('')

const isAvailable = ref(false)
let disposed = false
let stopListening: (() => void) | undefined
if (desktopClient.isAvailable()) {
  void desktopClient
    .listen(DESKTOP_EVENTS.STORAGE_CHANGED, ({ paths }) => {
      if (paths.includes('tyco-user.json')) {
        isAvailable.value = true
      }
    })
    .then((stop) => {
      if (disposed) stop()
      else stopListening = stop
    })
    .catch(() => {})
}
onScopeDispose(() => {
  disposed = true
  stopListening?.()
})

async function run(action: () => Promise<void>) {
  errorMessage.value = ''
  try {
    await action()
  } catch (error) {
    errorMessage.value = describeError(error, translate)
  }
}

const retry = () => run(store.restart)
const useDefault = () => run(() => store.relocate('useDefault'))
</script>

<style scoped>
.user-data-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  padding: var(--space-2xl);
  background-color: var(--color-base-100);
}

.user-data-missing-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-md);
  max-width: 36rem;
  padding: var(--space-2xl);
  border-radius: var(--radius-lg);
}

.user-data-missing-title {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 600;
}

.user-data-missing-text {
  margin: 0;
  color: var(--app-text-muted);
  line-height: 1.5;
}

.user-data-missing-path {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}

.user-data-setup-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.user-data-setup-option {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
}

.user-data-setup-option-title {
  color: var(--color-base-content);
  font-size: var(--text-body);
  font-weight: 600;
}

.user-data-missing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
</style>
