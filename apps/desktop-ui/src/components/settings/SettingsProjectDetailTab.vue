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
        type="submit"
        :form="formId"
        :disabled="!isValid"
        :loading="isCreating"
      >
        {{ t('settings.saveProject') }}
      </Button>
      <SettingsAutosaveStatus v-else :status="saveStatus" />
    </SettingsDetailHeader>

    <form
      v-if="isNew || project"
      :id="formId"
      class="settings-stack"
      @submit.prevent="handleCreate"
    >
      <fieldset class="contents" :disabled="isCreating">
        <InlineNotice
          v-if="!isNew && hasConflict"
          kind="warning"
          appearance="surface"
          icon="mdi:sync-alert"
          :message="t('settings.projectChangedElsewhere')"
          data-testid="project-conflict"
        >
          <Button size="sm" @click="resolveConflict(false)">
            {{ t('settings.conflictReload') }}
          </Button>
          <Button size="sm" variant="ghost" @click="resolveConflict(true)">
            {{ t('settings.conflictKeepMine') }}
          </Button>
        </InlineNotice>
        <SettingsSection :title="t('settings.aiEntityGeneral')">
          <FieldRow
            :label="t('settings.projectName')"
            :error="name.trim() ? undefined : t('settings.projectNameRequired')"
          >
            <FieldInput v-model="name" @update:model-value="change" />
          </FieldRow>
          <FieldRow
            v-if="!isNew"
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
            :hint="targetPath || undefined"
            :error="
              targetPath.trim() || isStored
                ? undefined
                : t('settings.projectPathRequired')
            "
            :warning="
              !targetPath.trim() && isStored
                ? t('settings.projectFolderNotSetOnDevice')
                : isInsideSyncedFolder
                  ? t('settings.projectInsideSyncedFolder')
                  : undefined
            "
          >
            <template #info><DeviceScopeBadge /></template>
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
      </fieldset>
    </form>

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
    <StateMessage v-else kind="loading" :message="t('common.inProgress')" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { useRetryToast } from '../../composables/use-retry-toast'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSettingsDraft } from '../../composables/use-settings-draft'
import useToast from '../../composables/use-toast'
import { vaultOfRef } from '../../lib/ai-profiles/profile-ref'
import {
  type ProjectAccessLevel,
  hasFileToolsOff,
  projectAccessLevelOf,
} from '../../lib/ai-profiles/project-access'
import { createProjectEditor } from '../../lib/ai-profiles/project-editor'
import {
  AI_OVERVIEW_TAB,
  NEW_ENTITY_ID,
  profileTab,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import SettingsAccessList, {
  type AccessListCandidate,
  type AccessListEntry,
} from './SettingsAccessList.vue'
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsSection from './SettingsSection.vue'
import type { ProjectPermission } from '@tyco/shared'

const props = defineProps<{ projectId: string }>()
const formId = useId()
const { navigate } = useSettingsContext()

const { t } = useI18n()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const { isBusy: isCreating, run: runCreating } = useBusyAction()
const isNew = computed(() => props.projectId === NEW_ENTITY_ID)

// only the profiles of the vault of the project may reach it
const profiles = computed(() =>
  aiProfilesStore.profiles.filter(
    (profile) => vaultOfRef(profile.id) === vaultOfRef(props.projectId)
  )
)

const projectTypeOptions = computed(() => [
  { id: 'internal', name: t('settings.projectTypeInternal') },
  { id: 'external', name: t('settings.projectTypeExternal') },
])

const editor = createProjectEditor({
  saveProject: async (fields) => {
    const current = aiProfilesStore.getProject(props.projectId)
    if (current) await aiProfilesStore.saveProject({ ...current, ...fields })
  },
  // a conflict is shown with its own choice, not as a failure
  reportError: (message, retry) => {
    if (!hasConflict.value) reportSaveError(message, retry)
  },
})
const reportSaveError = useRetryToast()
/** The folder, as stored, is synced with the data folder or a vault */
const isInsideSyncedFolder = computed(
  () =>
    Boolean(project.value?.isInsideSyncedFolder) &&
    targetPath.value.trim() === (project.value?.targetPath ?? '')
)
const hasConflict = computed(() =>
  Boolean(aiProfilesStore.projectConflicts[props.projectId])
)

async function resolveConflict(keepMine: boolean) {
  try {
    const stored = await aiProfilesStore.resolveProjectConflict(
      props.projectId,
      keepMine
    )
    if (!keepMine && stored) editor.load(stored)
  } catch (error) {
    toastError(error)
  }
}
const {
  name,
  description,
  isExternal,
  targetPath,
  isStored,
  isValid,
  saveStatus,
} = editor

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

useSettingsDraft(editor.flush)

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

function accessLevelOf(profile: {
  id: string
  projectPermissions: Record<string, ProjectPermission>
}): ProjectAccessLevel | undefined {
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
    .map((profile) => ({ id: profile.id, label: profile.name }))
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

async function handleCreate() {
  if (!isNew.value || !isValid.value || isCreating.value) return
  await runCreating(async () => {
    const created = await aiProfilesStore.createProject(editor.fields())
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
  })
}
</script>

<style scoped>
.vault-folder {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}
</style>
