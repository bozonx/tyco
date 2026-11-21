<template>
  <SettingsSection
    :title="t('settings.aiVaults.title')"
    :info="`${t('settings.aiVaults.hint')}\n\n${t('settings.aiVaults.attachedDeviceScopedHint')}`"
  >
    <template #actions>
      <Badge v-if="vault.status === 'notConnected'" tone="warning">
        {{ t('settings.aiVaults.notConnected') }}
      </Badge>
      <Badge v-else-if="vault.status === 'newer'" tone="warning">
        {{ t('settings.aiVaults.newer') }}
      </Badge>
      <DropdownMenu
        v-if="menuItems.length > 0"
        size="xs"
        square
        hide-chevron
        align="right"
        icon="mdi:dots-vertical"
        :title="t('commands.moreActions')"
        :items="menuItems"
      />
    </template>

    <div
      class="settings-section-content"
      :data-testid="`vault-${vault.vaultId || 'main'}`"
    >
      <PathDisplay
        :path="vault.path"
        :can-open="vault.status === 'connected'"
        @open="openVault"
      />
      <InlineNotice
        v-if="vault.isWritableByOthers"
        density="compact"
        kind="warning"
        :message="
          t('settings.aiVaults.writableByOthers', {
            name: vaultLabel(vault, t('settings.aiVaults.main')),
          })
        "
      />
    </div>

    <SettingsCreateEntityModal
      :open="isRenaming"
      :title="t('settings.aiVaults.rename')"
      :label="t('settings.aiVaults.name')"
      :confirm-text="t('common.save')"
      @submit="rename"
      @close="isRenaming = false"
    />
    <ConfirmModal
      :open="isDetachAsked"
      :title="t('settings.aiVaults.detach')"
      :message="t('settings.aiVaults.detachConfirm')"
      :confirm-text="t('settings.aiVaults.detach')"
      danger
      @confirm="detach"
      @cancel="isDetachAsked = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { vaultLabel } from '../../lib/ai-profiles/vault-groups'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Badge from '../common/Badge.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsSection from './SettingsSection.vue'
import type { VaultInfo } from '@tyco/shared'

/** The folder, name and place on this device of one workspace */
const props = defineProps<{ vault: VaultInfo }>()

const { t } = useI18n()
const { toastError } = useToast()
const store = useAiProfilesStore()

const isRenaming = ref(false)
const isDetachAsked = ref(false)

async function relink() {
  try {
    const path = await store.pickFolder()
    if (path) await store.relinkVault(props.vault.vaultId, path)
  } catch (error) {
    toastError(error)
  }
}

async function rename(name: string) {
  isRenaming.value = false
  try {
    await store.renameVault(props.vault.vaultId, name)
  } catch (error) {
    toastError(error)
  }
}

async function detach() {
  isDetachAsked.value = false
  try {
    await store.detachVault(props.vault.vaultId)
  } catch (error) {
    toastError(error)
  }
}

function openVault() {
  void store
    .openVaultDir(undefined, props.vault.vaultId)
    .catch((error: unknown) => toastError(error))
}

const menuItems = computed<DropdownMenuItem[]>(() => {
  const vault = props.vault
  const items: DropdownMenuItem[] = []
  if (vault.status === 'connected')
    items.push({
      label: t('settings.aiVaults.open'),
      icon: 'mdi:folder-open-outline',
      action: openVault,
    })
  if (vault.isMain) return items
  if (vault.status === 'connected')
    items.push({
      label: t('settings.aiVaults.rename'),
      icon: 'mdi:pencil-outline',
      action: () => {
        isRenaming.value = true
      },
    })
  else
    items.push({
      label: t('settings.aiVaults.relink'),
      icon: 'mdi:folder-search-outline',
      action: () => void relink(),
    })
  items.push({
    label: t('settings.aiVaults.detach'),
    icon: 'mdi:link-variant-off',
    action: () => {
      isDetachAsked.value = true
    },
  })
  return items
})
</script>
