<template>
  <SettingsSection
    :title="t('settings.aiVaults.title')"
    :info="t('settings.aiVaults.hint')"
  >
    <template #actions>
      <Button
        size="sm"
        icon="mdi:folder-plus-outline"
        :loading="isAttaching"
        @click="attach"
      >
        {{ t('settings.aiVaults.attach') }}
      </Button>
    </template>

    <div class="settings-section-content">
      <div class="settings-entity-list">
        <SettingsEntityItem
          v-for="vault in vaults"
          :key="vault.vaultId"
          :title="vaultLabel(vault, t('settings.aiVaults.main'))"
          :description="vault.path"
          :data-testid="`vault-${vault.vaultId || 'main'}`"
        >
          <template #actions>
            <Badge v-if="vault.status === 'notConnected'" tone="warning">
              {{ t('settings.aiVaults.notConnected') }}
            </Badge>
            <Badge v-else-if="vault.status === 'newer'" tone="warning">
              {{ t('settings.aiVaults.newer') }}
            </Badge>
            <DropdownMenu
              size="xs"
              square
              hide-chevron
              align="right"
              icon="mdi:dots-vertical"
              :title="t('commands.moreActions')"
              :items="vaultMenuItems(vault)"
            />
          </template>
        </SettingsEntityItem>
      </div>
      <InlineNotice
        v-for="vault in sharedVaults"
        :key="`shared-${vault.vaultId}`"
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
      :open="nameRequest !== null"
      :title="
        nameRequest?.vaultId
          ? t('settings.aiVaults.rename')
          : t('settings.aiVaults.newVault')
      "
      :label="t('settings.aiVaults.name')"
      :confirm-text="
        nameRequest?.vaultId ? t('common.save') : t('settings.aiVaults.attach')
      "
      @submit="answerName"
      @close="answerName(null)"
    />
    <ConfirmModal
      :open="subfolderRequest !== null"
      :title="t('settings.aiVaults.attach')"
      :message="
        t('settings.aiVaults.useSubfolder', {
          path: subfolderRequest?.path ?? '',
        })
      "
      :confirm-text="t('settings.aiVaults.attach')"
      @confirm="answerSubfolder(true)"
      @cancel="answerSubfolder(false)"
    />
    <ConfirmModal
      :open="vaultToDetach !== null"
      :title="t('settings.aiVaults.detach')"
      :message="t('settings.aiVaults.detachConfirm')"
      :confirm-text="t('settings.aiVaults.detach')"
      danger
      @confirm="detach"
      @cancel="vaultToDetach = null"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { attachPickedVault } from '../../lib/ai-profiles/vault-attach'
import { vaultLabel } from '../../lib/ai-profiles/vault-groups'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import type { VaultInfo } from '@tyco/shared'

const REFUSAL_KEYS = {
  duplicate: 'settings.aiVaults.refused.duplicate',
  nested: 'settings.aiVaults.refused.nested',
  occupied: 'settings.aiVaults.refused.occupied',
} as const

const { t } = useI18n()
const { toastError, toastText } = useToast()
const store = useAiProfilesStore()

const vaults = computed(() => store.vaults)
/** Vaults others may write to: their profiles run the commands of this device */
const sharedVaults = computed(() =>
  vaults.value.filter((vault) => vault.isWritableByOthers)
)

/** A name being asked: for a new vault, or to rename `vaultId` */
const nameRequest = ref<{
  vaultId: string
  resolve: (name: string | null) => void
} | null>(null)
const askName = (vaultId = '') =>
  new Promise<string | null>((resolve) => {
    nameRequest.value = { vaultId, resolve }
  })
function answerName(name: string | null) {
  nameRequest.value?.resolve(name)
  nameRequest.value = null
}

const subfolderRequest = ref<{
  path: string
  resolve: (isConfirmed: boolean) => void
} | null>(null)
function answerSubfolder(isConfirmed: boolean) {
  subfolderRequest.value?.resolve(isConfirmed)
  subfolderRequest.value = null
}

const { isBusy: isAttaching, run: runAttaching } = useBusyAction()

async function attach() {
  await runAttaching(async () => {
    try {
      await attachPickedVault({
        pickFolder: store.pickFolder,
        inspect: store.inspectVaultFolder,
        attach: store.attachVault,
        askName: () => askName(),
        confirmSubfolder: (path) =>
          new Promise((resolve) => {
            subfolderRequest.value = { path, resolve }
          }),
        refuse: (reason, detail) =>
          toastText(t(REFUSAL_KEYS[reason], { detail }), 'warn'),
      })
    } catch (error) {
      toastError(error)
    }
  })
}

async function relink(vault: VaultInfo) {
  try {
    const path = await store.pickFolder()
    if (path) await store.relinkVault(vault.vaultId, path)
  } catch (error) {
    toastError(error)
  }
}

async function rename(vault: VaultInfo) {
  const name = await askName(vault.vaultId)
  if (name === null) return
  try {
    await store.renameVault(vault.vaultId, name)
  } catch (error) {
    toastError(error)
  }
}

const vaultToDetach = ref<VaultInfo | null>(null)
async function detach() {
  const vault = vaultToDetach.value
  vaultToDetach.value = null
  if (!vault) return
  try {
    await store.detachVault(vault.vaultId)
  } catch (error) {
    toastError(error)
  }
}

function vaultMenuItems(vault: VaultInfo): DropdownMenuItem[] {
  const items: DropdownMenuItem[] = []
  if (vault.status === 'connected')
    items.push({
      label: t('settings.aiVaults.open'),
      icon: 'mdi:folder-open-outline',
      action: () =>
        void store
          .openVaultDir(undefined, vault.vaultId)
          .catch((error: unknown) => toastError(error)),
    })
  if (vault.isMain) return items
  if (vault.status === 'connected')
    items.push({
      label: t('settings.aiVaults.rename'),
      icon: 'mdi:pencil-outline',
      action: () => void rename(vault),
    })
  else
    items.push({
      label: t('settings.aiVaults.relink'),
      icon: 'mdi:folder-search-outline',
      action: () => void relink(vault),
    })
  items.push({
    label: t('settings.aiVaults.detach'),
    icon: 'mdi:link-variant-off',
    action: () => {
      vaultToDetach.value = vault
    },
  })
  return items
}
</script>
