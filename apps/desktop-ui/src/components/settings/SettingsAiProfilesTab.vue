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
        <template v-else>
          <div
            v-for="group in profileGroups"
            :key="group.vault.vaultId"
            class="vault-group"
          >
            <h4 v-if="profileGroups.length > 1" class="vault-group-title">
              {{ vaultLabel(group.vault, t('settings.aiVaults.main')) }}
            </h4>
            <div class="settings-entity-list">
              <SettingsEntityItem
                v-for="profile in group.items"
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
        </template>
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
        <InlineNotice
          v-if="projectsWithoutFolder.length > 1"
          density="compact"
          kind="warning"
          :message="
            t('settings.projectsWithoutFolder', {
              count: projectsWithoutFolder.length,
            })
          "
        />
        <StateMessage
          v-if="projects.length === 0"
          density="compact"
          :message="t('settings.noProjectsYet')"
        />
        <template v-else>
          <div
            v-for="group in projectGroups"
            :key="group.vault.vaultId"
            class="vault-group"
          >
            <h4 v-if="projectGroups.length > 1" class="vault-group-title">
              {{ vaultLabel(group.vault, t('settings.aiVaults.main')) }}
            </h4>
            <div class="settings-entity-list">
              <SettingsEntityItem
                v-for="project in group.items"
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
        </template>
      </div>
    </SettingsSection>

    <SettingsAiVaultsSection />

    <SettingsChatHistorySection scope="profiles" />

    <SettingsCreateEntityModal
      :open="showCreateProfileModal"
      :title="t('settings.newProfile')"
      :label="t('settings.profileName')"
      :confirm-text="t('settings.createProfile')"
      :is-submitting="isCreatingProfile"
      @submit="handleCreateProfile"
      @close="showCreateProfileModal = false"
    >
      <FieldRow
        v-if="vaultOptions.length > 1"
        vertical
        :separator="false"
        :label="t('settings.aiVaults.vault')"
      >
        <FieldSelect v-model="targetVaultId" :options="vaultOptions" />
      </FieldRow>
    </SettingsCreateEntityModal>

    <SettingsCreateEntityModal
      :open="showCreateProjectModal"
      :title="t('settings.newProject')"
      :label="t('settings.projectName')"
      :confirm-text="t('settings.createProject')"
      :is-submitting="isCreatingProject"
      :can-submit="!newProjectIsExternal || Boolean(newProjectPath)"
      @submit="handleCreateProject"
      @close="showCreateProjectModal = false"
    >
      <FieldRow
        vertical
        :separator="false"
        :label="t('settings.projectType')"
        :info="t('settings.projectTypeConvertHint')"
      >
        <SegmentedControl
          size="sm"
          :label="t('settings.projectType')"
          :model-value="newProjectIsExternal ? 'external' : 'internal'"
          :options="projectTypeOptions"
          @update:model-value="newProjectIsExternal = $event === 'external'"
        />
      </FieldRow>
      <SettingsProjectFolderField
        v-if="newProjectIsExternal"
        :path="newProjectPath"
        :disabled="isCreatingProject"
        @pick="pickNewProjectFolder"
      />
      <FieldRow
        v-if="vaultOptions.length > 1"
        vertical
        :separator="false"
        :label="t('settings.aiVaults.vault')"
      >
        <FieldSelect v-model="targetVaultId" :options="vaultOptions" />
      </FieldRow>
    </SettingsCreateEntityModal>

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
import { computed, onMounted, ref, watch } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { splitRef } from '../../lib/ai-profiles/profile-ref'
import { groupByVault, vaultLabel } from '../../lib/ai-profiles/vault-groups'
import { profileTab, projectTab } from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsAiVaultsSection from './SettingsAiVaultsSection.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsProjectFolderField from './SettingsProjectFolderField.vue'
import SettingsSection from './SettingsSection.vue'
import type { AiProject } from '@tyco/shared'

const { t } = useI18n()
const { navigate } = useSettingsContext()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const profiles = computed(() => aiProfilesStore.profiles)
const projects = computed(() => aiProfilesStore.projects)
const profileGroups = computed(() =>
  groupByVault(profiles.value, aiProfilesStore.vaults)
)
const projectGroups = computed(() =>
  groupByVault(projects.value, aiProfilesStore.vaults)
)
/** The vaults something can be made in now */
const vaultOptions = computed(() =>
  profileGroups.value.map(({ vault }) => ({
    id: vault.vaultId,
    name: vaultLabel(vault, t('settings.aiVaults.main')),
  }))
)
/** The vault a new profile or project goes to */
const targetVaultId = ref('')

/** An external project with no folder on this device */
const isWithoutFolder = (project: AiProject) =>
  project.isExternal && !project.targetPath?.trim()
const projectsWithoutFolder = computed(() =>
  projects.value.filter(isWithoutFolder)
)

async function setProjectFolder(project: AiProject) {
  try {
    await aiProfilesStore.setProjectFolder(project.id)
  } catch (error) {
    toastError(error)
  }
}

/**
 * The folder of a profile when it is outside the main vault or has a custom
 * folder
 */
function describeProfile(profile: { id: string }): string {
  const { vaultId, id } = splitRef(profile.id)
  if (vaultId) {
    const vault = aiProfilesStore.vaults.find((v) => v.vaultId === vaultId)
    if (vault && !vault.isMain) {
      return vaultLabel(vault, '')
    }
  }
  if (!id.startsWith('profile-')) {
    return id
  }
  return ''
}

/** The description of a project or folder setup notices */
function describeProject(project: AiProject): string {
  if (isWithoutFolder(project)) return t('settings.projectFolderNotSetOnDevice')
  if (project.isInsideSyncedFolder)
    return t('settings.projectInsideSyncedFolder')
  return project.description?.trim() || ''
}

onMounted(() => {
  void aiProfilesStore.loadAll()
})

// ---------------------------------------------------------------------------
// Actions menu for profile
// ---------------------------------------------------------------------------

function profileMenuItems(profile: {
  readonly id: string
  readonly name: string
}): DropdownMenuItem[] {
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
const profileToDuplicate = ref<{ id: string; name: string } | null>(null)

function askDuplicateProfile(profile: { id: string; name: string }) {
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
const profileToDelete = ref<{ id: string; name: string } | null>(null)
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

async function askDeleteProfile(profile: { id: string; name: string }) {
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
    ...(isWithoutFolder(project)
      ? [
          {
            label: t('settings.projectSetFolder'),
            icon: 'mdi:folder-open-outline',
            action: () => setProjectFolder(project),
          },
        ]
      : []),
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
      vaultId: targetVaultId.value,
      soul: t('settings.profileDefaultSoul'),
      settings: {},
    })
    showCreateProfileModal.value = false
    navigate(profileTab(created.id))
  })
}

const showCreateProjectModal = ref(false)
const { isBusy: isCreatingProject, run: runCreatingProject } = useBusyAction()
const newProjectIsExternal = ref(false)
const newProjectPath = ref('')
const projectTypeOptions = computed(() => [
  { id: 'internal', name: t('settings.projectTypeInternal') },
  { id: 'external', name: t('settings.projectTypeExternal') },
])

watch(showCreateProjectModal, (open) => {
  if (!open) return
  newProjectIsExternal.value = false
  newProjectPath.value = ''
})

async function pickNewProjectFolder() {
  try {
    const picked = await aiProfilesStore.pickFolder()
    if (picked) newProjectPath.value = picked
  } catch (error) {
    toastError(error)
  }
}

async function handleCreateProject(name: string) {
  await runCreatingProject(async () => {
    const created = await aiProfilesStore.createProject({
      name,
      vaultId: targetVaultId.value,
      isExternal: newProjectIsExternal.value,
      targetPath: newProjectIsExternal.value ? newProjectPath.value : undefined,
    })
    showCreateProjectModal.value = false
    navigate(projectTab(created.id))
  })
}
</script>

<style scoped>
.vault-group + .vault-group {
  margin-top: var(--space-md);
}

.vault-group-title {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}
</style>
