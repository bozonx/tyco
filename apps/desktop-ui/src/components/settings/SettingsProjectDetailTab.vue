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
        :disabled="!isValid"
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

      <SettingsSection v-if="!isNew" :title="t('settings.aiProfilesTab')">
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
              :icon="profileIcon(profile)"
              :title="profile.name"
              openable
              @open="navigate(profileTab(profile.id))"
            >
              <span class="settings-entity-meta">
                {{ t('settings.accessRead') }}:
                {{ formatAccess(profile.projectPermissions[projectId]?.read) }}
              </span>
              <span class="settings-entity-meta">
                {{ t('settings.accessWrite') }}:
                {{ formatAccess(profile.projectPermissions[projectId]?.write) }}
              </span>
            </SettingsEntityItem>
          </div>
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
import { createProjectEditor } from '../../lib/ai-profiles/project-editor'
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
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDangerZone from './SettingsDangerZone.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import {
  DEFAULT_PROJECT_PERMISSION,
  type ProjectAccessMode,
} from '@tyco/shared'

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

/** A profile without an entry for the project has no access to it */
function formatAccess(
  mode: ProjectAccessMode = DEFAULT_PROJECT_PERMISSION.read
): string {
  if (mode === 'allow') return t('settings.accessAllow')
  if (mode === 'ask') return t('settings.accessAsk')
  return t('settings.accessDeny')
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
  if (!isValid.value) return
  try {
    const created = await aiProfilesStore.createProject(editor.fields())
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
