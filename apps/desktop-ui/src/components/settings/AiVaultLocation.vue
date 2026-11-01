<template>
  <FieldRow
    :label="t('settings.aiVaultPath')"
    :hint="t('settings.aiVaultExternalHint')"
    :error="vaultError || undefined"
    vertical
  >
    <template #info><DeviceScopeBadge /></template>
    <div class="vault-path-control">
      <FieldInput
        class="vault-path-input"
        readonly
        :model-value="vaultPath || userConfig.aiVault.path"
      />
      <Button
        size="sm"
        variant="neutral"
        icon="mdi:folder-edit-outline"
        @click="isModalOpen = true"
      >
        {{ t('settings.vaultChange') }}
      </Button>
      <Button
        size="sm"
        variant="neutral"
        icon="mdi:folder-open-outline"
        :disabled="Boolean(vaultError)"
        @click="openVault"
      >
        {{ t('settings.openInFileManager') }}
      </Button>
    </div>
    <InlineNotice
      density="compact"
      kind="warning"
      :message="t('settings.aiVaultGitWarning')"
    />
  </FieldRow>
  <SettingsVaultLocationModal
    :open="isModalOpen"
    :current-path="vaultPath || userConfig.aiVault.path"
    :is-custom="Boolean(userConfig.aiVault.path)"
    @close="isModalOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import SettingsVaultLocationModal from './SettingsVaultLocationModal.vue'

/**
 * Where the AI profiles live on this device: inside the user data folder by
 * default, or in a folder of its own, e.g. for git or Obsidian
 */
const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()
const vaultPath = computed(() => aiProfilesStore.vaultPath)
const vaultError = computed(() => aiProfilesStore.vaultError)
const isModalOpen = ref(false)

onMounted(() => {
  if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()
})

async function openVault() {
  try {
    await aiProfilesStore.openVaultDir()
  } catch (error) {
    toastError(error)
  }
}
</script>

<style scoped>
.vault-path-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
}
.vault-path-input {
  flex: 1;
  min-width: 12rem;
}
</style>
