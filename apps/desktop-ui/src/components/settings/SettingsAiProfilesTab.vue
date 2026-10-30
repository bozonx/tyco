<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.aiProfilesTab')"
      :info="t('settings.aiProfilesHint')"
    >
      <template #actions>
        <Button
          size="sm"
          variant="primary"
          icon="mdi:plus"
          @click="showCreateProfileModal = true"
        >
          {{ t('settings.newProfile') }}
        </Button>
      </template>

      <div class="settings-section-content">
        <StateMessage
          v-if="profiles.length === 0"
          density="compact"
          :message="t('settings.noProfilesYet')"
        />
        <div v-else class="settings-entity-list">
          <SettingsEntityItem
            v-for="profile in profiles"
            :key="profile.id"
            :title="profile.name"
            :description="describeProfile(profile)"
            openable
            @open="navigate(profileTab(profile.id))"
          >
            <template #actions>
              <DropdownMenu
                size="xs"
                square
                hide-chevron
                align="right"
                icon="mdi:dots-vertical"
                :title="t('commands.moreActions')"
                :items="profileMenuItems(profile)"
              />
            </template>
          </SettingsEntityItem>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.projectsTitle')"
      :info="t('settings.projectsHint')"
    >
      <template #actions>
        <Button
          size="sm"
          variant="primary"
          icon="mdi:plus"
          @click="showCreateProjectModal = true"
        >
          {{ t('settings.newProject') }}
        </Button>
      </template>

      <div class="settings-section-content">
        <StateMessage
          v-if="projects.length === 0"
          density="compact"
          :message="t('settings.noProjectsYet')"
        />
        <div v-else class="settings-entity-list">
          <SettingsEntityItem
            v-for="project in projects"
            :key="project.id"
            :title="project.name"
            :description="describeProject(project)"
            openable
            @open="navigate(projectTab(project.id))"
          >
            <template #actions>
              <DropdownMenu
                size="xs"
                square
                hide-chevron
                align="right"
                icon="mdi:dots-vertical"
                :title="t('commands.moreActions')"
                :items="projectMenuItems(project)"
              />
            </template>
          </SettingsEntityItem>
        </div>
      </div>
    </SettingsSection>

    <SettingsChatHistorySection scope="profiles" />

    <SettingsSection
      :title="t('settings.aiVaultTitle')"
      :info="t('settings.aiVaultPathHint')"
    >
      <FieldRow
        :label="t('settings.aiVaultPath')"
        :error="vaultError || undefined"
      >
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
            @click="showVaultModal = true"
          >
            {{ t('settings.vaultChange') }}
          </Button>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-open-outline"
            :disabled="Boolean(vaultError)"
            @click="handleOpenVault"
          >
            {{ t('settings.openInFileManager') }}
          </Button>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsVaultLocationModal
      :open="showVaultModal"
      :current-path="vaultPath || userConfig.aiVault.path"
      :is-custom="Boolean(userConfig.aiVault.path)"
      @close="showVaultModal = false"
    />

    <SettingsCreateEntityModal
      :open="showCreateProfileModal"
      :title="t('settings.newProfile')"
      :label="t('settings.profileName')"
      :confirm-text="t('settings.createProfile')"
      :is-submitting="isCreatingProfile"
      @submit="handleCreateProfile"
      @close="showCreateProfileModal = false"
    />

    <SettingsCreateEntityModal
      :open="showCreateProjectModal"
      :title="t('settings.newProject')"
      :label="t('settings.projectName')"
      :confirm-text="t('settings.createProject')"
      :is-submitting="isCreatingProject"
      @submit="handleCreateProject"
      @close="showCreateProjectModal = false"
    />

    <ConfirmModal
      :open="showDuplicateProfileConfirm"
      :title="t('settings.duplicateProfile')"
      :message="
        t('settings.duplicateProfileConfirm', {
          name: profileToDuplicate?.name ?? '',
        })
      "
      :confirm-text="t('settings.duplicateProfile')"
      @confirm="handleDuplicateProfile"
      @cancel="showDuplicateProfileConfirm = false"
    />

    <ConfirmModal
      :open="showDeleteProfileConfirm"
      :title="t('settings.deleteProfile')"
      :message="deleteProfileMessage"
      :confirm-text="t('settings.deleteProfile')"
      danger
      @confirm="handleDeleteProfile"
      @cancel="showDeleteProfileConfirm = false"
    />

    <ConfirmModal
      :open="showDeleteProjectConfirm"
      :title="t('settings.deleteProject')"
      :message="t('settings.deleteProjectConfirm')"
      :confirm-text="t('settings.deleteProject')"
      danger
      @confirm="handleDeleteProject"
      @cancel="showDeleteProjectConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { projectAccessLevelOf } from '../../lib/ai-profiles/project-access'
import {
  CHAT_TOOL_GROUPS,
  toolGroupSettings,
} from '../../lib/chat-tools/chat-tool-groups'
import { profileTab, projectTab } from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsVaultLocationModal from './SettingsVaultLocationModal.vue'
import type { AiProfile, AiProject } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const profiles = computed(() => aiProfilesStore.profiles)
const projects = computed(() => aiProfilesStore.projects)
const vaultPath = computed(() => aiProfilesStore.vaultPath)
const vaultError = computed(() => aiProfilesStore.vaultError)

/** The tools a profile may use, in one line */
function describeProfile(profile: AiProfile): string {
  const tools = CHAT_TOOL_GROUPS.filter(
    (group) => toolGroupSettings(profile.tools, group).isEnabled
  ).map((group) => t(group.labelKey))
  return tools.length > 0 ? tools.join(' · ') : t('settings.profileNoTools')
}

/** The profiles assigned to the project, or a fallback when none are connected */
function describeProject(project: AiProject): string {
  const assigned = profiles.value.filter(
    (profile) =>
      projectAccessLevelOf(profile.projectPermissions[project.id]) !== undefined
  )
  return assigned.length > 0
    ? assigned.map((p) => p.name).join(', ')
    : t('settings.noProfilesWithAccess')
}

onMounted(() => {
  void aiProfilesStore.loadAll()
})

// ---------------------------------------------------------------------------
// Actions menu for profile
// ---------------------------------------------------------------------------

function profileMenuItems(profile: AiProfile): DropdownMenuItem[] {
  return [
    {
      label: t('settings.duplicateProfile'),
      icon: 'mdi:content-copy',
      action: () => askDuplicateProfile(profile),
    },
    {
      label: t('common.delete'),
      icon: 'mdi:trash-can-outline',
      action: () => askDeleteProfile(profile),
    },
  ]
}

const showDuplicateProfileConfirm = ref(false)
const profileToDuplicate = ref<AiProfile | null>(null)

function askDuplicateProfile(profile: AiProfile) {
  profileToDuplicate.value = profile
  showDuplicateProfileConfirm.value = true
}

async function handleDuplicateProfile() {
  if (!profileToDuplicate.value) return
  const profile = profileToDuplicate.value
  showDuplicateProfileConfirm.value = false
  try {
    const copy = await aiProfilesStore.duplicateProfile(
      profile.id,
      t('settings.profileCopyName', { name: profile.name })
    )
    navigate(profileTab(copy.id))
  } catch (error) {
    toastError(error)
  } finally {
    profileToDuplicate.value = null
  }
}

const showDeleteProfileConfirm = ref(false)
const profileToDelete = ref<AiProfile | null>(null)
const chatCount = ref<number | null>(null)

const deleteProfileMessage = computed(() => {
  const profileName = profileToDelete.value?.name ?? ''
  return chatCount.value === null
    ? t('settings.deleteProfileConfirmUncounted', { name: profileName })
    : t('settings.deleteProfileConfirm', {
        name: profileName,
        count: chatCount.value,
      })
})

async function askDeleteProfile(profile: AiProfile) {
  profileToDelete.value = profile
  chatCount.value = await aiProfilesStore
    .countChats(profile.id)
    .catch(() => null)
  showDeleteProfileConfirm.value = true
}

async function handleDeleteProfile() {
  if (!profileToDelete.value) return
  try {
    await aiProfilesStore.deleteProfile(profileToDelete.value.id)
  } catch (error) {
    toastError(error)
  } finally {
    showDeleteProfileConfirm.value = false
    profileToDelete.value = null
  }
}

// ---------------------------------------------------------------------------
// Actions menu for project
// ---------------------------------------------------------------------------

function projectMenuItems(project: AiProject): DropdownMenuItem[] {
  return [
    {
      label: t('common.delete'),
      icon: 'mdi:trash-can-outline',
      action: () => askDeleteProject(project),
    },
  ]
}

const showDeleteProjectConfirm = ref(false)
const projectToDelete = ref<AiProject | null>(null)

function askDeleteProject(project: AiProject) {
  projectToDelete.value = project
  showDeleteProjectConfirm.value = true
}

async function handleDeleteProject() {
  if (!projectToDelete.value) return
  try {
    await aiProfilesStore.deleteProject(projectToDelete.value.id)
  } catch (error) {
    toastError(error)
  } finally {
    showDeleteProjectConfirm.value = false
    projectToDelete.value = null
  }
}

// ---------------------------------------------------------------------------
// Create profile & project
// ---------------------------------------------------------------------------

const showCreateProfileModal = ref(false)
const { isBusy: isCreatingProfile, run: runCreatingProfile } = useBusyAction()

async function handleCreateProfile(name: string) {
  await runCreatingProfile(async () => {
    const created = await aiProfilesStore.createProfile({
      name,
      soul: t('settings.profileDefaultSoul'),
      settings: {},
    })
    showCreateProfileModal.value = false
    navigate(profileTab(created.id))
  })
}

const showCreateProjectModal = ref(false)
const { isBusy: isCreatingProject, run: runCreatingProject } = useBusyAction()

async function handleCreateProject(name: string) {
  await runCreatingProject(async () => {
    const created = await aiProfilesStore.createProject({
      name,
      isExternal: false,
    })
    showCreateProjectModal.value = false
    navigate(projectTab(created.id))
  })
}

// ---------------------------------------------------------------------------
// AI Vault Folder
// ---------------------------------------------------------------------------

async function handleOpenVault() {
  try {
    await aiProfilesStore.openVaultDir()
  } catch (error) {
    toastError(error)
  }
}

const showVaultModal = ref(false)
</script>

<style scoped>
.vault-path-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}

.vault-path-input {
  flex: 1 1 14rem;
  min-width: 0;
}
</style>
