<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.aiProfilesTab')"
      @back="navigate(AI_OVERVIEW_TAB)"
    >
      <Button
        v-if="isNew"
        size="sm"
        variant="primary"
        icon="mdi:content-save"
        :disabled="!isValid || Boolean(folderError)"
        @click="handleCreate"
      >
        {{ t('settings.saveProject') }}
      </Button>
      <SettingsAutosaveStatus v-else :status="saveStatus" />
    </SettingsDetailHeader>

    <template v-if="isNew || project">
      <SettingsSection :title="t('settings.aiEntityGeneral')">
        <FieldRow :label="t('settings.projectName')">
          <FieldInput v-model="name" @update:model-value="change" />
        </FieldRow>
        <FieldRow
          v-if="isNew"
          :label="t('settings.vaultFolder')"
          :info="t('settings.projectFolderHint')"
          :hint="`projects/${folder.folderId.value}`"
          :error="folderError"
        >
          <FieldInput
            v-model="folder.typedId.value"
            :placeholder="folder.suggestedId.value"
          />
        </FieldRow>
        <FieldRow
          v-else
          :label="t('settings.vaultFolder')"
          :info="t('settings.projectFolderFixedHint')"
        >
          <code class="vault-folder">projects/{{ projectId }}</code>
        </FieldRow>
        <FieldRow :label="t('settings.projectDescription')">
          <FieldInput v-model="description" @update:model-value="change" />
        </FieldRow>
        <FieldRow :label="t('settings.projectType')">
          <SegmentedControl
            size="sm"
            :label="t('settings.projectType')"
            :model-value="isExternal ? 'external' : 'internal'"
            :options="projectTypeOptions"
            @update:model-value="changeType($event === 'external')"
          />
        </FieldRow>
        <FieldRow
          v-if="isExternal"
          :label="t('settings.projectTargetPath')"
          :info="targetPath || undefined"
        >
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-open-outline"
            @click="handlePickFolder"
          >
            {{ t('settings.selectFolder') }}
          </Button>
        </FieldRow>
      </SettingsSection>

      <SettingsSection
        :title="t('settings.projectProfileAccess')"
        :info="t('settings.projectProfileAccessHint')"
      >
        <div class="settings-section-content">
          <SettingsAccessList
            :entries="accessEntries"
            :candidates="accessCandidates"
            :add-label="t('settings.grantProfileAccess')"
            :empty-message="
              profiles.length === 0
                ? t('settings.noProfilesYet')
                : t('settings.noProfilesWithAccess')
            "
            :openable="!isNew"
            @change="changeAccess"
            @open="(profileId) => navigate(profileTab(profileId))"
          />
        </div>
      </SettingsSection>

      <SettingsSection v-if="!isNew" :title="t('settings.deleteProject')">
        <div class="settings-section-content">
          <SettingsDangerZone
            :message="t('settings.deleteProjectConfirm')"
            :action-label="t('settings.deleteProject')"
            @action="showDeleteConfirm = true"
          />
        </div>
      </SettingsSection>
    </template>

    <StateMessage
      v-else-if="aiProfilesStore.isLoaded"
      icon="mdi:folder-question-outline"
      :title="t('settings.projectNotFound')"
      :message="t('settings.projectNotFoundHint')"
    >
      <Button size="sm" variant="neutral" @click="navigate(AI_OVERVIEW_TAB)">
        {{ t('settings.aiProfilesTab') }}
      </Button>
    </StateMessage>
    <StateMessage v-else kind="loading" />

    <ConfirmModal
      :open="showDeleteConfirm"
      :title="t('settings.deleteProject')"
      :message="t('settings.deleteProjectConfirm')"
      :confirm-text="t('settings.deleteProject')"
      danger
      @confirm="handleDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useRetryToast } from '../../composables/use-retry-toast'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { profileIcon } from '../../lib/ai-profiles/profile-icons'
import {
  type ProjectAccessLevel,
  hasFileToolsOff,
  projectAccessLevelOf,
} from '../../lib/ai-profiles/project-access'
import { createProjectEditor } from '../../lib/ai-profiles/project-editor'
import { createVaultFolderField } from '../../lib/ai-profiles/vault-folder-field'
import {
  AI_OVERVIEW_TAB,
  NEW_ENTITY_ID,
  profileTab,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsAccessList, {
  type AccessListCandidate,
  type AccessListEntry,
} from './SettingsAccessList.vue'
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDangerZone from './SettingsDangerZone.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsSection from './SettingsSection.vue'
import type { AiProfile } from '@tyco/shared'

const props = defineProps<{ projectId: string }>()
const { navigate } = useSettingsContext()

const { t } = useI18n()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const isNew = computed(() => props.projectId === NEW_ENTITY_ID)
const showDeleteConfirm = ref(false)

const profiles = computed(() => aiProfilesStore.profiles)

const projectTypeOptions = computed(() => [
  { id: 'internal', name: t('settings.projectTypeInternal') },
  { id: 'external', name: t('settings.projectTypeExternal') },
])

const editor = createProjectEditor({
  saveProject: async (fields) => {
    const current = aiProfilesStore.getProject(props.projectId)
    if (current) await aiProfilesStore.saveProject({ ...current, ...fields })
  },
  reportError: useRetryToast(),
})
const { name, description, isExternal, targetPath, isValid, saveStatus } =
  editor

// the fields take the project once it is there; the settings may open
// before the vault is read
const project = computed(() =>
  isNew.value ? undefined : aiProfilesStore.getProject(props.projectId)
)
watch(
  () => Boolean(project.value),
  (isThere) => {
    if (isThere) editor.load(project.value)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  void editor.flush()
})

/** Only an existing project is stored on change; a new one waits for Save */
function change() {
  if (!isNew.value) editor.change()
}

function changeType(external: boolean) {
  isExternal.value = external
  change()
}

/** The access a new project gives on creation, by profile */
const pendingAccess = ref<Record<string, ProjectAccessLevel>>({})

function accessLevelOf(profile: AiProfile): ProjectAccessLevel | undefined {
  return isNew.value
    ? pendingAccess.value[profile.id]
    : projectAccessLevelOf(profile.projectPermissions[props.projectId])
}

const accessEntries = computed<AccessListEntry[]>(() =>
  profiles.value.flatMap((profile) => {
    const level = accessLevelOf(profile)
    if (!level) return []
    return [
      {
        id: profile.id,
        icon: profileIcon(profile),
        title: profile.name,
        level,
        warning: hasFileToolsOff(profile)
          ? t('settings.projectAccessFileToolsOff')
          : undefined,
      },
    ]
  })
)

const accessCandidates = computed<AccessListCandidate[]>(() =>
  profiles.value
    .filter((profile) => !accessLevelOf(profile))
    .map((profile) => ({
      id: profile.id,
      icon: profileIcon(profile),
      label: profile.name,
    }))
)

function changeAccess(
  profileId: string,
  level: ProjectAccessLevel | undefined
) {
  if (isNew.value) {
    const { [profileId]: _removed, ...rest } = pendingAccess.value
    pendingAccess.value = level ? { ...rest, [profileId]: level } : rest
    return
  }
  void aiProfilesStore
    .setProjectAccess(profileId, props.projectId, level)
    .catch(toastError)
}

async function handlePickFolder() {
  try {
    const picked = await aiProfilesStore.pickFolder()
    if (picked) {
      targetPath.value = picked
      change()
    }
  } catch (error) {
    toastError(error)
  }
}

const folder = createVaultFolderField({
  name: () => name.value,
  fallback: 'project',
  takenIds: () => aiProfilesStore.projects.map(({ id }) => id),
})
const folderError = computed(() =>
  folder.errorKey.value ? t(folder.errorKey.value) : undefined
)

async function handleCreate() {
  if (!isValid.value || folderError.value) return
  try {
    const created = await aiProfilesStore.createProject({
      ...editor.fields(),
      id: folder.folderId.value,
    })
    // the project is there either way: a failed grant is reported, not undone
    const grants = await Promise.allSettled(
      Object.entries(pendingAccess.value).map(([profileId, level]) =>
        aiProfilesStore.setProjectAccess(profileId, created.id, level)
      )
    )
    for (const grant of grants) {
      if (grant.status === 'rejected') toastError(grant.reason)
    }
    pendingAccess.value = {}
    navigate(projectTab(created.id))
  } catch (error) {
    toastError(error)
  }
}

async function handleDelete() {
  if (isNew.value) return
  editor.cancel()
  try {
    await aiProfilesStore.deleteProject(props.projectId)
    showDeleteConfirm.value = false
    navigate(AI_OVERVIEW_TAB)
  } catch (error) {
    toastError(error)
  }
}
</script>

<style scoped>
.vault-folder {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}
</style>
