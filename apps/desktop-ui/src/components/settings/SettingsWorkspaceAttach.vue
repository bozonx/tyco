<template>
  <Button
    size="sm"
    variant="ghost"
    icon="mdi:folder-plus-outline"
    :loading="isAttaching"
    data-testid="workspace-attach"
    @click="attach"
  >
    {{ t('settings.aiVaults.attach') }}
  </Button>

  <SettingsCreateEntityModal
    :open="isNameAsked"
    :title="t('settings.aiVaults.newVault')"
    :label="t('settings.aiVaults.name')"
    :confirm-text="t('settings.aiVaults.attach')"
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { attachPickedVault } from '../../lib/ai-profiles/vault-attach'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'

const emit = defineEmits<{
  /** A workspace was attached; its id */
  attached: [vaultId: string]
}>()

const REFUSAL_KEYS = {
  duplicate: 'settings.aiVaults.refused.duplicate',
  nested: 'settings.aiVaults.refused.nested',
  occupied: 'settings.aiVaults.refused.occupied',
} as const

const { t } = useI18n()
const { toastError, toastText } = useToast()
const store = useAiProfilesStore()

const nameResolver = ref<((name: string | null) => void) | null>(null)
const isNameAsked = computed(() => nameResolver.value !== null)
function answerName(name: string | null) {
  nameResolver.value?.(name)
  nameResolver.value = null
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
    const before = new Set(store.vaults.map((vault) => vault.vaultId))
    try {
      await attachPickedVault({
        pickFolder: store.pickFolder,
        inspect: store.inspectVaultFolder,
        attach: store.attachVault,
        askName: () =>
          new Promise<string | null>((resolve) => {
            nameResolver.value = resolve
          }),
        confirmSubfolder: (path) =>
          new Promise((resolve) => {
            subfolderRequest.value = { path, resolve }
          }),
        refuse: (reason, detail) =>
          toastText(t(REFUSAL_KEYS[reason], { detail }), 'warn'),
      })
    } catch (error) {
      toastError(error)
      return
    }
    const added = store.vaults.find((vault) => !before.has(vault.vaultId))
    if (added) emit('attached', added.vaultId)
  })
}
</script>
