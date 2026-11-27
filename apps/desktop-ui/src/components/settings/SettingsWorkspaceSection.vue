<template>
  <SettingsSection
    :title="t('settings.aiWorkspaces.title')"
    :info="`${t('settings.aiWorkspaces.hint')}\n\n${t('settings.aiWorkspaces.attachedDeviceScopedHint')}`"
  >
    <template #actions>
      <Badge v-if="workspace.status === 'notConnected'" tone="warning">
        {{ t('settings.aiWorkspaces.notConnected') }}
      </Badge>
      <Badge v-else-if="workspace.status === 'newer'" tone="warning">
        {{ t('settings.aiWorkspaces.newer') }}
      </Badge>
    </template>

    <div
      class="settings-section-content"
      :data-testid="`workspace-${workspace.workspaceId || 'main'}`"
    >
      <PathDisplay
        :path="workspace.path"
        :can-open="workspace.status === 'connected'"
        @open="openWorkspace"
      />
      <div v-if="!workspace.isMain" class="flex flex-wrap gap-2">
        <Button
          v-if="workspace.status === 'connected'"
          size="sm"
          variant="neutral"
          icon="mdi:pencil-outline"
          @click="isRenaming = true"
        >
          {{ t('settings.aiWorkspaces.rename') }}
        </Button>
        <Button
          v-else
          size="sm"
          variant="neutral"
          icon="mdi:folder-search-outline"
          @click="relink"
        >
          {{ t('settings.aiWorkspaces.relink') }}
        </Button>
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:link-variant-off"
          @click="isDetachAsked = true"
        >
          {{ t('settings.aiWorkspaces.detach') }}
        </Button>
      </div>
      <InlineNotice
        v-if="workspace.isWritableByOthers"
        density="compact"
        kind="warning"
        :message="
          t('settings.aiWorkspaces.writableByOthers', {
            name: workspaceLabel(workspace, t('settings.aiWorkspaces.main')),
          })
        "
      />
    </div>

    <SettingsCreateEntityModal
      :open="isRenaming"
      :title="t('settings.aiWorkspaces.rename')"
      :label="t('settings.aiWorkspaces.name')"
      :confirm-text="t('common.save')"
      @submit="rename"
      @close="isRenaming = false"
    />
    <ConfirmModal
      :open="isDetachAsked"
      :title="t('settings.aiWorkspaces.detach')"
      :message="t('settings.aiWorkspaces.detachConfirm')"
      :confirm-text="t('settings.aiWorkspaces.detach')"
      danger
      @confirm="detach"
      @cancel="isDetachAsked = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { workspaceLabel } from '../../lib/ai-profiles/workspace-groups'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsSection from './SettingsSection.vue'
import type { WorkspaceInfo } from '@tyco/shared'

/** The folder, name and place on this device of one workspace */
const props = defineProps<{ workspace: WorkspaceInfo }>()

const { t } = useI18n()
const { toastError } = useToast()
const store = useAiProfilesStore()

const isRenaming = ref(false)
const isDetachAsked = ref(false)

async function relink() {
  try {
    const path = await store.pickFolder()
    if (path) await store.relinkWorkspace(props.workspace.workspaceId, path)
  } catch (error) {
    toastError(error)
  }
}

async function rename(name: string) {
  isRenaming.value = false
  try {
    await store.renameWorkspace(props.workspace.workspaceId, name)
  } catch (error) {
    toastError(error)
  }
}

async function detach() {
  isDetachAsked.value = false
  try {
    await store.detachWorkspace(props.workspace.workspaceId)
  } catch (error) {
    toastError(error)
  }
}

function openWorkspace() {
  void store
    .openWorkspaceDir(undefined, props.workspace.workspaceId)
    .catch((error: unknown) => toastError(error))
}
</script>
