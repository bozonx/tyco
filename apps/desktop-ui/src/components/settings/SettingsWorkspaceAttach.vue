<template>
  <Button
    size="sm"
    variant="ghost"
    icon="mdi:folder-plus-outline"
    :loading="isAttaching"
    data-testid="workspace-attach"
    @click="attach"
  >
    {{ t('settings.aiWorkspaces.attach') }}
  </Button>

  <SettingsCreateEntityModal
    :open="isNameAsked"
    :title="t('settings.aiWorkspaces.newWorkspace')"
    :label="t('settings.aiWorkspaces.name')"
    :confirm-text="t('settings.aiWorkspaces.attach')"
    @submit="answerName"
    @close="answerName(null)"
  />
  <ConfirmModal
    :open="subfolderRequest !== null"
    :title="t('settings.aiWorkspaces.attach')"
    :message="
      t('settings.aiWorkspaces.useSubfolder', {
        path: subfolderRequest?.path ?? '',
      })
    "
    :confirm-text="t('settings.aiWorkspaces.attach')"
    @confirm="answerSubfolder(true)"
    @cancel="answerSubfolder(false)"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { attachPickedWorkspace } from '../../lib/ai-profiles/workspace-attach'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'

const emit = defineEmits<{
  /** A workspace was attached; its id */
  attached: [workspaceId: string]
}>()

const REFUSAL_KEYS = {
  duplicate: 'settings.aiWorkspaces.refused.duplicate',
  nested: 'settings.aiWorkspaces.refused.nested',
  occupied: 'settings.aiWorkspaces.refused.occupied',
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
    const before = new Set(
      store.workspaces.map((workspace) => workspace.workspaceId)
    )
    try {
      await attachPickedWorkspace({
        pickFolder: store.pickFolder,
        inspect: store.inspectWorkspaceFolder,
        attach: store.attachWorkspace,
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
    const added = store.workspaces.find(
      (workspace) => !before.has(workspace.workspaceId)
    )
    if (added) emit('attached', added.workspaceId)
  })
}
</script>
