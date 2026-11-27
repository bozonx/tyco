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
          <FieldRow :label="t('settings.projectDescription')">
            <FieldTextArea
              v-model="description"
              :rows="3"
              @update:model-value="change"
            />
          </FieldRow>
          <FieldRow v-if="isNew" :label="t('settings.projectType')">
            <SegmentedControl
              size="sm"
              :label="t('settings.projectType')"
              :model-value="isExternal ? 'external' : 'internal'"
              :options="projectTypeOptions"
              @update:model-value="changeType($event === 'external')"
            />
          </FieldRow>
          <FieldRow
            v-if="!isNew || isExternal"
            vertical
            :label="t('settings.projectFolder')"
            :info="
              isExternal
                ? t('settings.projectFolderExternalHint')
                : t('settings.projectFolderInternalHint')
            "
            :error="
              isExternal && !targetPath.trim() && !isStored
                ? t('settings.projectPathRequired')
                : undefined
            "
            :warning="
              isExternal && !targetPath.trim() && isStored
                ? t('settings.projectFolderNotSetOnDeviceHint')
                : isInsideSyncedFolder
                  ? t('settings.projectInsideSyncedFolder')
                  : undefined
            "
            :device-scoped="isExternal"
            data-testid="project-folder"
          >
            <template v-if="!isNew" #action>
              <Button
                size="sm"
                variant="neutral"
                icon="mdi:swap-horizontal"
                data-testid="project-convert"
                @click="isConverting = true"
              >
                {{
                  isExternal
                    ? t('settings.projectConvertToInternal')
                    : t('settings.projectConvertToExternal')
                }}
              </Button>
            </template>
            <template #badge>
              <Badge v-if="isExternal" tone="accent" data-testid="project-type">
                {{ t('settings.projectBadgeExternal') }}
              </Badge>
            </template>
            <div class="project-folder">
              <PathDisplay
                :path="isExternal ? targetPath : `projects/${projectId}`"
                :placeholder="
                  isStored
                    ? t('settings.projectFolderNotSetOnDevice')
                    : t('settings.projectFolderNotSelected')
                "
                :can-open="canOpenFolder"
                :open-label="t('settings.projectFolderOpen')"
                @open="handleOpenFolder"
              >
                <template v-if="isExternal" #actions>
                  <Button
                    size="sm"
                    :variant="targetPath.trim() ? 'ghost' : 'primary'"
                    :icon="
                      targetPath.trim()
                        ? 'mdi:folder-edit-outline'
                        : 'mdi:folder-open-outline'
                    "
                    :title="
                      targetPath.trim()
                        ? t('settings.projectFolderRelinkHint')
                        : undefined
                    "
                    data-testid="project-folder-pick"
                    @click="handlePickFolder"
                  >
                    {{
                      targetPath.trim()
                        ? t('settings.projectFolderChange')
                        : t('settings.selectFolder')
                    }}
                  </Button>
                </template>
              </PathDisplay>
            </div>
          </FieldRow>
        </SettingsSection>

        <SettingsSection
          :title="t('settings.projectProfileAccess')"
          :info="t('settings.projectProfileAccessHint')"
        >
          <div v-if="isNew" class="settings-section-content">
            <StateMessage
              v-if="profiles.length === 0"
              density="compact"
              :message="t('settings.noProfilesYet')"
            />
            <div v-else class="settings-entity-list">
              <SettingsEntityItem
                v-for="p in profiles"
                :key="p.id"
                :title="p.name"
              >
                <FieldCheckbox
                  :aria-label="p.name"
                  :model-value="Boolean(pendingAccess[p.id])"
                  @update:model-value="togglePendingAccess(p.id, $event)"
                />
              </SettingsEntityItem>
            </div>
          </div>
          <div v-else class="settings-section-content">
            <div class="settings-entity-list">
              <SettingsEntityItem
                v-for="entry in accessEntries"
                :key="entry.id"
                :title="entry.title"
                :description="entry.warning"
                openable
                open-target="title"
                @open="navigate(profileTab(entry.id))"
              >
                <Badge :tone="entry.tone">{{ entry.label }}</Badge>
              </SettingsEntityItem>
              <StateMessage
                v-if="accessEntries.length === 0"
                density="compact"
                :message="
                  profiles.length === 0
                    ? t('settings.noProfilesYet')
                    : t('settings.noProfilesWithAccess')
                "
              />
            </div>
          </div>
        </SettingsSection>
      </fieldset>
    </form>

    <SettingsProjectConvertDialog
      v-if="project"
      :open="isConverting"
      :to-external="!project.isExternal"
      :has-source-folder="Boolean(project.targetPath)"
      :is-busy="isConvertBusy"
      :select-folder="pickFolderSafely"
      :inspect="inspectTransfer"
      @confirm="handleConvert"
      @cancel="isConverting = false"
    />

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
import type { ConvertProjectOptions } from '../../lib/ai-profiles/ai-projects-model'
import { vaultOfRef } from '../../lib/ai-profiles/profile-ref'
import {
  DEFAULT_PROJECT_ACCESS_LEVEL,
  PROJECT_ACCESS_LABEL_KEYS,
  type ProjectAccessLevel,
  hasFileToolsOff,
  isDeleteAllowed,
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
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PathDisplay from '../common/PathDisplay.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsProjectConvertDialog from './SettingsProjectConvertDialog.vue'
import SettingsSection from './SettingsSection.vue'
import type { ProjectPermission } from '@tyco/shared'

const props = defineProps<{ projectId: string }>()
const formId = useId()
const { navigate } = useSettingsContext()

const { t } = useI18n()
const { toastError, toastKey } = useToast()
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
  saveProject: async (fields, expectedRevision) => {
    const current = aiProfilesStore.getProject(props.projectId)
    if (!current) throw new Error(`Project not found: ${props.projectId}`)
    return aiProfilesStore.saveProject({
      ...current,
      ...fields,
      revision: expectedRevision,
    })
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
    // Include edits typed after the conflict appeared before choosing a version.
    if (keepMine) await editor.flush()
    else editor.cancel()
    const stored = await aiProfilesStore.resolveProjectConflict(
      props.projectId,
      keepMine
    )
    if (stored) editor.load(stored)
  } catch (error) {
    toastError(error)
  }
}
const { name, description, isExternal, targetPath, isStored, isValid } = editor

// the fields take the project once it is there; the settings may open
// before the vault is read
const project = computed(() =>
  isNew.value ? undefined : aiProfilesStore.getProject(props.projectId)
)
watch(
  () => project.value,
  (stored) => {
    if (stored && !hasConflict.value) editor.syncFromStored(stored)
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

const ACCESS_LEVEL_TONES: Record<
  ProjectAccessLevel,
  'neutral' | 'accent' | 'success'
> = { read: 'neutral', readWrite: 'accent', full: 'success', custom: 'neutral' }

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

function togglePendingAccess(profileId: string, enabled: boolean) {
  if (enabled) {
    pendingAccess.value = {
      ...pendingAccess.value,
      [profileId]: DEFAULT_PROJECT_ACCESS_LEVEL,
    }
  } else {
    const { [profileId]: _removed, ...rest } = pendingAccess.value
    pendingAccess.value = rest
  }
}

/** The profiles with access, as the profiles set it */
const accessEntries = computed(() =>
  profiles.value.flatMap((profile) => {
    const level = accessLevelOf(profile)
    if (!level) return []
    const permission = profile.projectPermissions[props.projectId]
    return [
      {
        id: profile.id,
        title: profile.name,
        label:
          level === 'full' && isDeleteAllowed(permission)
            ? `${t(PROJECT_ACCESS_LABEL_KEYS[level])} · ${t('settings.accessDeleteWithoutAsking')}`
            : t(PROJECT_ACCESS_LABEL_KEYS[level]),
        tone: ACCESS_LEVEL_TONES[level],
        warning: hasFileToolsOff(profile)
          ? t('settings.projectAccessFileToolsOff')
          : undefined,
      },
    ]
  })
)

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

/** The folder of a stored project is there to open on this device */
const canOpenFolder = computed(
  () =>
    !isNew.value &&
    (!isExternal.value ||
      (Boolean(targetPath.value.trim()) &&
        targetPath.value.trim() === (project.value?.targetPath ?? '')))
)

async function handleOpenFolder() {
  try {
    await aiProfilesStore.openProjectFolder(props.projectId)
  } catch (error) {
    toastError(error)
  }
}

const isConverting = ref(false)
const { isBusy: isConvertBusy, run: runConverting } = useBusyAction()

async function pickFolderSafely(): Promise<string | null> {
  try {
    return await aiProfilesStore.pickFolder()
  } catch (error) {
    toastError(error)
    return null
  }
}

/** What converting the project would transfer into `targetPath` */
const inspectTransfer = (targetPath?: string) =>
  aiProfilesStore.inspectProjectTransfer(props.projectId, targetPath)

/** Changes the type after the edits typed so far are stored */
async function handleConvert(options: ConvertProjectOptions) {
  await runConverting(async () => {
    await editor.flush()
    const { project: converted, isSourceLeft } =
      await aiProfilesStore.convertProject(props.projectId, options)
    editor.load(converted)
    isConverting.value = false
    if (isSourceLeft)
      toastKey(
        converted.isExternal
          ? 'settings.projectConvertLeftInWorkspace'
          : 'settings.projectConvertLeftInFolder',
        'warn'
      )
  })
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
.project-folder {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
</style>
