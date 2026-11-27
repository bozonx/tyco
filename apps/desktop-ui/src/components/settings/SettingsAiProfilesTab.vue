<template>
  <div class="settings-stack">
    <div class="workspace-bar">
      <SegmentedControl
        v-if="workspaceOptions.length > 1"
        size="sm"
        :label="t('settings.aiVaults.vault')"
        :model-value="activeVault.vaultId"
        :options="workspaceOptions"
        data-testid="workspace-switcher"
        @update:model-value="selectWorkspace"
      />
      <SettingsWorkspaceAttach @attached="selectWorkspace" />
    </div>

    <template v-if="!isActiveConnected">
      <StateMessage
        :message="t('settings.workspaceNotConnected')"
        data-testid="workspace-not-connected"
      />
      <SettingsWorkspaceSection :vault="activeVault" />
    </template>
    <template v-else>
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
            v-if="activeProfiles.length === 0"
            density="compact"
            :message="t('settings.noProfilesYet')"
          />
          <template v-else>
            <div>
              <div class="settings-entity-list">
                <SettingsEntityItem
                  v-for="profile in activeProfiles"
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
            v-if="activeProjects.length === 0"
            density="compact"
            :message="t('settings.noProjectsYet')"
          />
          <template v-else>
            <div>
              <div class="settings-entity-list">
                <SettingsEntityItem
                  v-for="project in activeProjects"
                  :key="project.id"
                  :title="project.name"
                  :description="describeProject(project)"
                  openable
                  @open="navigate(projectTab(project.id))"
                >
                  <Badge v-if="project.isExternal" tone="accent">
                    {{ t('settings.projectBadgeExternal') }}
                  </Badge>
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

      <SettingsWorkspaceHistorySection :vault="activeVault" />
      <SettingsWorkspaceSection :vault="activeVault" />
    </template>

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
      :can-submit="!newProjectIsExternal || Boolean(newProjectPath)"
      @submit="handleCreateProject"
      @close="showCreateProjectModal = false"
    >
      <FieldRow
        vertical
        :separator="false"
        :label="t('settings.projectType')"
        :info="t('settings.projectTypeHint')"
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
    </SettingsCreateEntityModal>

    <SettingsMoveToWorkspaceModal
      :kind="entityToMove?.kind ?? 'profile'"
      :entity="entityToMove"
      :is-submitting="isMoving"
      @confirm="handleMove"
      @close="entityToMove = null"
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
      :message="
        t(
          projectToDelete?.isExternal
            ? 'settings.deleteExternalProjectConfirm'
            : 'settings.deleteInternalProjectConfirm',
          { name: projectToDelete?.name ?? '' }
        )
      "
      :confirm-text="t('settings.deleteProject')"
      danger
      @confirm="handleDeleteProject"
      @cancel="showDeleteProjectConfirm = false"
    />
  </div>
</template>

<script lang="ts">
import { ref as moduleRef } from 'vue'

/** The workspace last shown, kept while the app runs */
const lastWorkspaceId = moduleRef('')
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { moveTargets } from '../../lib/ai-profiles/entity-move'
import { splitRef, vaultOfRef } from '../../lib/ai-profiles/profile-ref'
import { isProjectEmpty } from '../../lib/ai-profiles/project-files'
import { vaultLabel } from '../../lib/ai-profiles/vault-groups'
import { profileTab, projectTab } from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsCreateEntityModal from './SettingsCreateEntityModal.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsMoveToWorkspaceModal from './SettingsMoveToWorkspaceModal.vue'
import SettingsProjectFolderField from './SettingsProjectFolderField.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsWorkspaceAttach from './SettingsWorkspaceAttach.vue'
import SettingsWorkspaceHistorySection from './SettingsWorkspaceHistorySection.vue'
import SettingsWorkspaceSection from './SettingsWorkspaceSection.vue'
import type { AiProject, VaultInfo } from '@tyco/shared'

const { t } = useI18n()
const { navigate } = useSettingsContext()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const profiles = computed(() => aiProfilesStore.profiles)
const projects = computed(() => aiProfilesStore.projects)

/** The workspace shown; the main one when the chosen one is gone */
const activeVault = computed<VaultInfo>(
  () =>
    aiProfilesStore.vaults.find(
      (vault) => vault.vaultId === lastWorkspaceId.value
    ) ??
    aiProfilesStore.vaults.find((vault) => vault.isMain) ?? {
      vaultId: '',
      name: '',
      path: '',
      isMain: true,
      status: 'connected',
      isWritableByOthers: false,
      chatHistory: {},
    }
)
const isActiveConnected = computed(
  () => activeVault.value.status === 'connected'
)
const workspaceOptions = computed(() =>
  aiProfilesStore.vaults.map((vault) => ({
    id: vault.vaultId,
    name: vaultLabel(vault, t('settings.aiVaults.main')),
    icon: vault.status === 'connected' ? undefined : 'mdi:alert-outline',
  }))
)
function selectWorkspace(vaultId: string) {
  lastWorkspaceId.value = vaultId
}
const inActiveVault = (item: { id: string }) =>
  vaultOfRef(item.id) === activeVault.value.vaultId
const activeProfiles = computed(() => profiles.value.filter(inActiveVault))
const activeProjects = computed(() => projects.value.filter(inActiveVault))
/** The vault a new profile or project goes to */
const targetVaultId = computed(() => activeVault.value.vaultId)

/** An external project with no folder on this device */
const isWithoutFolder = (project: AiProject) =>
  project.isExternal && !project.targetPath?.trim()
const projectsWithoutFolder = computed(() =>
  activeProjects.value.filter(isWithoutFolder)
)

async function openProjectFolder(project: AiProject) {
  try {
    await aiProfilesStore.openProjectFolder(project.id)
  } catch (error) {
    toastError(error)
  }
}

async function setProjectFolder(project: AiProject) {
  try {
    await aiProfilesStore.setProjectFolder(project.id)
  } catch (error) {
    toastError(error)
  }
}

/** The folder of a profile when it has a custom one */
function describeProfile(profile: { id: string }): string {
  const { id } = splitRef(profile.id)
  return id.startsWith('profile-') ? '' : id
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
    ...moveItem('profile', profile),
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
  const count = await aiProfilesStore.countChats(profile.id).catch(() => null)
  chatCount.value = count

  let isProfileEmpty = false
  if (count === 0) {
    try {
      const [soul, memory] = await Promise.all([
        aiProfilesStore.readSoul(profile.id).catch(() => ''),
        aiProfilesStore.listMemoryTopics(profile.id).catch(() => []),
      ])
      isProfileEmpty = !soul.trim() && memory.length === 0
    } catch {
      isProfileEmpty = false
    }
  }

  if (isProfileEmpty) {
    await handleDeleteProfile()
    return
  }
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
    isWithoutFolder(project)
      ? {
          label: t('settings.projectSetFolder'),
          icon: 'mdi:folder-plus-outline',
          action: () => setProjectFolder(project),
        }
      : {
          label: t('settings.projectFolderOpen'),
          icon: 'mdi:folder-open-outline',
          action: () => openProjectFolder(project),
        },
    ...moveItem('project', project),
    {
      label: t('common.delete'),
      icon: 'mdi:trash-can-outline',
      action: () => askDeleteProject(project),
    },
  ]
}

const showDeleteProjectConfirm = ref(false)
const projectToDelete = ref<AiProject | null>(null)

/** Asks before deleting a project, unless deleting it loses nothing */
async function askDeleteProject(project: AiProject) {
  projectToDelete.value = project
  const fileCount = project.isExternal
    ? null
    : await aiProfilesStore
        .inspectProjectTransfer(project.id)
        .then((preview) => preview.files.fileCount)
        .catch(() => null)
  if (isProjectEmpty(project, profiles.value, fileCount)) {
    await handleDeleteProject()
    return
  }
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
// Move to another workspace
// ---------------------------------------------------------------------------

const entityToMove = ref<{
  kind: 'profile' | 'project'
  id: string
  name: string
} | null>(null)
const { isBusy: isMoving, run: runMoving } = useBusyAction()

function moveItem(
  kind: 'profile' | 'project',
  entity: { readonly id: string; readonly name: string }
): DropdownMenuItem[] {
  if (moveTargets(entity.id, aiProfilesStore.vaults).length === 0) return []
  return [
    {
      label: t('settings.moveToWorkspace.action'),
      icon: 'mdi:folder-move-outline',
      action: () => {
        entityToMove.value = { kind, id: entity.id, name: entity.name }
      },
    },
  ]
}

async function handleMove(vaultId: string) {
  const entity = entityToMove.value
  if (!entity) return
  await runMoving(async () => {
    try {
      if (entity.kind === 'profile')
        await aiProfilesStore.moveProfile(entity.id, vaultId)
      else await aiProfilesStore.moveProject(entity.id, vaultId)
      entityToMove.value = null
      selectWorkspace(vaultId)
    } catch (error) {
      toastError(error)
    }
  })
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
.workspace-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.workspace-bar > :last-child {
  margin-left: auto;
}
</style>
