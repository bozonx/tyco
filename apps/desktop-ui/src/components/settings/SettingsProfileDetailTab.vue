<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.aiProfilesTab')"
      @back="navigate(AI_OVERVIEW_TAB)"
    />

    <template v-if="isNew">
      <SettingsSection :title="t('settings.newProfile')">
        <form class="profile-create-form" @submit.prevent="handleCreate">
          <FieldRow :label="t('settings.profileName')">
            <FieldInput
              ref="nameInputRef"
              v-model="newName"
              autofocus
              :disabled="isCreating"
            />
          </FieldRow>
          <div class="profile-form-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon="mdi:plus"
              :disabled="!newName.trim()"
              :loading="isCreating"
            >
              {{ t('settings.createProfile') }}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </template>

    <template v-else-if="profile">
      <InlineNotice
        v-if="editor.hasConflict.value"
        kind="warning"
        appearance="surface"
        icon="mdi:sync-alert"
        :message="t('settings.profileChangedElsewhere')"
        data-testid="profile-conflict"
      >
        <Button size="sm" @click="resolveConflict(false)">
          {{ t('settings.conflictReload') }}
        </Button>
        <Button size="sm" variant="ghost" @click="resolveConflict(true)">
          {{ t('settings.conflictKeepMine') }}
        </Button>
      </InlineNotice>
      <SettingsSection
        :title="t('settings.aiEntityGeneral')"
        :info="t('settings.profileGenerationHint')"
      >
        <FieldRow
          :label="t('settings.profileName')"
          :error="name.trim() ? undefined : t('settings.profileNameRequired')"
        >
          <FieldInput v-model="name" @update:model-value="changeName" />
        </FieldRow>
        <FieldRow
          :label="t('settings.vaultFolder')"
          :info="t('settings.vaultFolderFixedHint')"
        >
          <PathDisplay
            :path="`profiles/${profile.id}`"
            can-open
            :open-label="t('settings.openProfileFolder')"
            @open="handleOpenFolder"
          />
        </FieldRow>
      </SettingsSection>

      <SettingsProfileToolsSection
        :sources="toolSources"
        :tools="profile.tools"
        :catalog="desktopStore.userConfig?.tools"
        @update="changeSettings({ tools: $event })"
      >
        <SettingsEntityItem
          icon="mdi:console-line"
          icon-tone="secondary"
          :title="t('chatTools.commands.group')"
          :info="t('chatTools.commands.groupHint')"
        >
          <Badge tone="muted">
            {{ t('toolPermissions.contextTokens', { count: commandTokens }) }}
          </Badge>
        </SettingsEntityItem>
        <div class="pt-2">
          <SettingsProfileCommandTools
            :commands="commands"
            :selected-ids="profile.tools?.commandIds ?? []"
            :current-platform="desktopStore.userData?.platform"
            @toggle="toggleProfileCommand"
            @update-selected="setProfileCommands"
          />
        </div>
      </SettingsProfileToolsSection>

      <SettingsSection
        :title="t('settings.projectsTitle')"
        :info="t('settings.projectPermissionsHint')"
      >
        <div class="settings-section-content">
          <InlineNotice
            v-if="hasFileToolsOff(profile)"
            density="compact"
            kind="warning"
            icon="mdi:alert-outline"
            :message="t('settings.profileFileToolsOff')"
          />
          <SettingsProfileProjectAccess
            :projects="projects"
            :permissions="profile.projectPermissions"
            @change="setProjectAccess"
            @delete-allowed="setProjectDeleteAllowed"
            @open="(projectId) => navigate(projectTab(projectId))"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        :title="t('settings.profileSoulPrompt')"
        :info="t('settings.profileSoulPromptHint')"
      >
        <div class="settings-section-content">
          <FieldPromptTextArea
            v-model="soulPrompt"
            :disabled="!editor.isSoulLoaded.value"
            :rows="8"
            auto-resize
            :max-auto-height="400"
            :aria-label="t('settings.profileSoulPrompt')"
            :modal-title="t('settings.profileSoulPrompt')"
            @update:model-value="changeSoul"
          />
          <div v-if="editor.soulLoadError.value" class="profile-form-actions">
            <Button
              size="sm"
              :disabled="editor.isSoulLoading.value"
              @click="editor.loadSoul()"
            >
              {{ t('common.retry') }}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsProfileMemorySection
        :profile="profile"
        @update:memory-mode="changeMemoryMode"
      />
    </template>

    <StateMessage
      v-else-if="aiProfilesStore.isLoaded"
      icon="mdi:account-question-outline"
      :title="t('settings.profileNotFound')"
      :message="t('settings.profileNotFoundHint')"
    >
      <Button size="sm" variant="neutral" @click="navigate(AI_OVERVIEW_TAB)">
        {{ t('settings.aiProfilesTab') }}
      </Button>
    </StateMessage>
    <StateMessage v-else kind="loading" :message="t('common.inProgress')" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { usePluginToolSources } from '../../composables/use-plugin-tool-sources'
import { useRetryToast } from '../../composables/use-retry-toast'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSettingsDraft } from '../../composables/use-settings-draft'
import useToast from '../../composables/use-toast'
import { createProfileEditor } from '../../lib/ai-profiles/profile-editor'
import { vaultOfRef } from '../../lib/ai-profiles/profile-ref'
import {
  type ProjectAccessLevel,
  hasFileToolsOff,
  withProjectAccess,
  withProjectDeleteAllowed,
} from '../../lib/ai-profiles/project-access'
import { withCommandSelected } from '../../lib/chat-tools/tool-catalog'
import {
  CORE_CATALOG,
  estimateToolTokens,
} from '../../lib/chat-tools/tool-catalog-entries'
import {
  AI_OVERVIEW_TAB,
  NEW_ENTITY_ID,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsProfileCommandTools from './SettingsProfileCommandTools.vue'
import SettingsProfileMemorySection from './SettingsProfileMemorySection.vue'
import SettingsProfileProjectAccess from './SettingsProfileProjectAccess.vue'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'
import SettingsSection from './SettingsSection.vue'

const props = defineProps<{ profileId: string }>()
const { navigate } = useSettingsContext()

const { t } = useI18n()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()
const desktopStore = useDesktopStore()

const commands = computed(() => desktopStore.userConfig?.commands ?? [])

const pluginToolSources = usePluginToolSources()
const toolSources = computed(() => [
  ...CORE_CATALOG,
  ...pluginToolSources.value,
])

function toggleProfileCommand(commandId: string, enabled: boolean) {
  // the ids of removed commands go with any change of the list
  const known = new Set(commands.value.map((command) => command.id))
  const tools = withCommandSelected(profile.value?.tools, commandId, enabled)
  void changeSettings({
    tools: {
      ...tools,
      commandIds: tools.commandIds.filter((id) => known.has(id)),
    },
  })
}

function setProfileCommands(commandIds: string[]) {
  void changeSettings({
    tools: {
      ...withCommandSelected(profile.value?.tools, '', false),
      commandIds,
    },
  })
}

/** About how much of the context the picked commands take */
const commandTokens = computed(() => {
  const selected = new Set(profile.value?.tools?.commandIds ?? [])
  return commands.value
    .filter((command) => selected.has(command.id))
    .reduce(
      (total, command) =>
        total +
        estimateToolTokens({
          name: command.id,
          description: command.description,
        }),
      0
    )
})

function setProjectDeleteAllowed(projectId: string, isAllowed: boolean) {
  if (!profile.value) return
  void changeSettings({
    projectPermissions: withProjectDeleteAllowed(
      profile.value.projectPermissions,
      projectId,
      isAllowed
    ),
  })
}

const isNew = computed(() => props.profileId === NEW_ENTITY_ID)
const profile = computed(() => aiProfilesStore.getProfile(props.profileId))
// a profile reaches only the projects of its own vault
const projects = computed(() =>
  aiProfilesStore.projects.filter(
    (project) => vaultOfRef(project.id) === vaultOfRef(props.profileId)
  )
)

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const newName = ref('')
const nameInputRef = ref<{ focus?: () => void } | null>(null)
const { isBusy: isCreating, run: runCreating } = useBusyAction()

onMounted(() => {
  if (isNew.value) {
    void nextTick(() => {
      nameInputRef.value?.focus?.()
    })
  }
})

async function handleCreate() {
  if (!newName.value.trim() || isCreating.value) return
  await runCreating(async () => {
    const created = await aiProfilesStore.createProfile({
      name: newName.value,
      soul: t('settings.profileDefaultSoul'),
      settings: {},
    })
    navigate(`ai-profile:${created.id}`)
  })
}

// ---------------------------------------------------------------------------
// Advanced settings toggle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings: typed ones are stored a moment after they change, picked ones
// at once
// ---------------------------------------------------------------------------

const editor = createProfileEditor({
  getProfile: () => aiProfilesStore.getProfile(props.profileId),
  updateProfile: (patch, expectedRevision) =>
    aiProfilesStore.updateProfile(props.profileId, patch, expectedRevision),
  readSoul: () => aiProfilesStore.readSoulWithRevision(props.profileId),
  writeSoul: (content, expectedRevision) =>
    aiProfilesStore.writeSoul(props.profileId, content, expectedRevision),
  hasProfileConflict: () =>
    Boolean(aiProfilesStore.profileConflicts[props.profileId]),
  resolveProfileConflict: (keepMine) =>
    aiProfilesStore.resolveProfileConflict(props.profileId, keepMine),
  reportError: useRetryToast(),
})

async function resolveConflict(keepMine: boolean) {
  try {
    await editor.resolveConflict(keepMine)
  } catch (error) {
    toastError(error)
  }
}
const {
  name,
  soulPrompt,
  changeName,
  changeSoul,
  changeMemoryMode,
  changeSettings,
} = editor

// the fields take the profile once it is there; the settings may open
// before the vault is read
watch(
  () => Boolean(profile.value),
  (isThere) => {
    if (isThere && profile.value) void editor.load(profile.value)
  },
  { immediate: true }
)

/**
 * The files may be edited by hand while the app is in the background: back in
 * it, the page shows them as they are, so that a save does not undo the edit
 */
async function syncFromDisk() {
  if (isNew.value || !profile.value) return
  try {
    const stored = await aiProfilesStore.refreshProfile(props.profileId)
    if (stored) await editor.syncFromStored(stored)
  } catch {
    // the page keeps what it shows; the profile may be gone meanwhile
  }
}
// a change another device or editor made, read when the watcher reported it:
// a page without edits takes it silently
watch(
  [
    () => profile.value?.revision,
    () => aiProfilesStore.profileStorageRevisions?.[props.profileId],
  ],
  () => {
    if (!editor.hasConflict.value) void syncFromDisk()
  }
)
function syncWhenVisible() {
  if (document.visibilityState === 'visible') void syncFromDisk()
}
onMounted(() => {
  window.addEventListener('focus', syncWhenVisible)
  document.addEventListener('visibilitychange', syncWhenVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', syncWhenVisible)
  document.removeEventListener('visibilitychange', syncWhenVisible)
})

function setProjectAccess(
  projectId: string,
  level: ProjectAccessLevel | undefined
) {
  if (!profile.value) return
  void changeSettings({
    projectPermissions: withProjectAccess(
      profile.value.projectPermissions,
      projectId,
      level
    ),
  })
}

useSettingsDraft(editor.flush)

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

async function handleOpenFolder() {
  try {
    await aiProfilesStore.openVaultDir(props.profileId)
  } catch (error) {
    toastError(error)
  }
}
</script>

<style scoped>
.profile-create-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.profile-form-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
