<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.aiProfilesTab')"
      @back="navigate(AI_OVERVIEW_TAB)"
    >
      <template v-if="profile && !isNew">
        <SettingsAutosaveStatus :status="editor.saveStatus.value" />
      </template>
    </SettingsDetailHeader>

    <template v-if="isNew">
      <SettingsSection :title="t('settings.newProfile')">
        <form class="profile-create-form" @submit.prevent="handleCreate">
          <FieldRow :label="t('settings.profileName')">
            <FieldInput ref="nameInputRef" v-model="newName" autofocus />
          </FieldRow>
          <FieldRow
            :label="t('settings.vaultFolder')"
            :info="t('settings.vaultFolderHint')"
            :hint="`profiles/${folder.folderId.value}`"
            :error="folderError"
          >
            <FieldInput
              v-model="folder.typedId.value"
              :placeholder="folder.suggestedId.value"
            />
          </FieldRow>
          <div class="profile-form-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon="mdi:plus"
              :disabled="!newName.trim() || Boolean(folderError) || isCreating"
            >
              {{ t('settings.createProfile') }}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </template>

    <template v-else-if="profile">
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
          <div class="profile-folder-row">
            <code class="vault-folder">profiles/{{ profile.id }}</code>
            <Button
              size="sm"
              variant="neutral"
              icon="mdi:folder-open-outline"
              @click="handleOpenFolder"
            >
              {{ t('settings.openProfileFolder') }}
            </Button>
          </div>
        </FieldRow>

        <div class="advanced-toggle">
          <DisclosureHeader
            density="compact"
            icon="mdi:tune-variant"
            icon-size="md"
            :expanded="isAdvancedExpanded"
            :controls="advancedId"
            :title="
              isAdvancedExpanded
                ? t('settings.hideAdvanced')
                : t('settings.showAdvanced')
            "
            @toggle="isAdvancedExpanded = !isAdvancedExpanded"
          />
        </div>

        <div v-if="isAdvancedExpanded" :id="advancedId">
          <FieldRow
            :label="t('settings.temperature')"
            :error="
              temperatureError
                ? t('settings.numberTemperatureInvalid')
                : undefined
            "
          >
            <FieldNumber
              min="0"
              :max="MAX_PROFILE_TEMPERATURE"
              step="0.1"
              :model-value="temperatureText"
              :placeholder="t('settings.profileUseModelValue')"
              :aria-invalid="temperatureError || undefined"
              @update:model-value="changeTemperature"
              @invalid-input="temperatureError = true"
            />
          </FieldRow>
          <FieldRow
            :label="t('settings.maxTokens')"
            :error="
              maxOutputTokensError
                ? t('settings.numberTokensInvalid')
                : undefined
            "
          >
            <FieldNumber
              min="1"
              :model-value="maxOutputTokensText"
              :placeholder="t('settings.profileUseModelValue')"
              :aria-invalid="maxOutputTokensError || undefined"
              @update:model-value="changeMaxOutputTokens"
              @invalid-input="maxOutputTokensError = true"
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsProfileToolsSection
        v-if="CHAT_TOOL_GROUPS.length > 0"
        :groups="CHAT_TOOL_GROUPS"
        :tools="profile.tools"
        :step-count-text="stepCountText"
        :step-count-error="stepCountError"
        @update="changeSettings({ tools: $event })"
        @change-step-count="changeStepCount"
        @invalid-step-count="stepCountError = true"
      >
        <template #group="{ group, settings }">
          <InlineNotice
            v-if="group.id === FILES_TOOL_GROUP_ID && settings.access === 'ask'"
            density="compact"
            icon="mdi:information-outline"
            :message="t('settings.profileFilesAskAll')"
          />
        </template>
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
            @open="(projectId) => navigate(projectTab(projectId))"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        :title="t('settings.profileSoulPrompt')"
        :info="t('settings.profileSoulPromptHint')"
      >
        <div class="settings-section-content">
          <FieldTextArea
            v-model="soulPrompt"
            :disabled="!editor.isSoulLoaded.value"
            :rows="8"
            auto-resize
            :max-auto-height="400"
            :aria-label="t('settings.profileSoulPrompt')"
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
    <StateMessage v-else kind="loading" />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useRetryToast } from '../../composables/use-retry-toast'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { createProfileEditor } from '../../lib/ai-profiles/profile-editor'
import {
  type ProjectAccessLevel,
  hasFileToolsOff,
  withProjectAccess,
} from '../../lib/ai-profiles/project-access'
import { createVaultFolderField } from '../../lib/ai-profiles/vault-folder-field'
import {
  CHAT_TOOL_GROUPS,
  FILES_TOOL_GROUP_ID,
} from '../../lib/chat-tools/chat-tool-groups'
import {
  AI_OVERVIEW_TAB,
  NEW_ENTITY_ID,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsProfileMemorySection from './SettingsProfileMemorySection.vue'
import SettingsProfileProjectAccess from './SettingsProfileProjectAccess.vue'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'
import SettingsSection from './SettingsSection.vue'
import { MAX_PROFILE_TEMPERATURE } from '@tyco/shared'

const props = defineProps<{ profileId: string }>()
const { navigate } = useSettingsContext()

const { t } = useI18n()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const isNew = computed(() => props.profileId === NEW_ENTITY_ID)
const profile = computed(() => aiProfilesStore.getProfile(props.profileId))
const projects = computed(() => aiProfilesStore.projects)

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const newName = ref('')
const nameInputRef = ref<{ focus?: () => void } | null>(null)
const isCreating = ref(false)

onMounted(() => {
  if (isNew.value) {
    void nextTick(() => {
      nameInputRef.value?.focus?.()
    })
  }
})

const folder = createVaultFolderField({
  name: () => newName.value,
  fallback: 'profile',
  takenIds: () => aiProfilesStore.profiles.map(({ id }) => id),
})
const folderError = computed(() =>
  folder.errorKey.value ? t(folder.errorKey.value) : undefined
)

async function handleCreate() {
  if (!newName.value.trim() || folderError.value || isCreating.value) return
  isCreating.value = true
  try {
    const created = await aiProfilesStore.createProfile({
      name: newName.value,
      id: folder.folderId.value,
      soul: t('settings.profileDefaultSoul'),
      settings: {},
    })
    navigate(`ai-profile:${created.id}`)
  } catch (error) {
    toastError(error)
  } finally {
    isCreating.value = false
  }
}

// ---------------------------------------------------------------------------
// Advanced settings toggle
// ---------------------------------------------------------------------------

const isAdvancedExpanded = ref(false)
const advancedId = useId()

// ---------------------------------------------------------------------------
// Settings: typed ones are stored a moment after they change, picked ones
// at once
// ---------------------------------------------------------------------------

const editor = createProfileEditor({
  getProfile: () => aiProfilesStore.getProfile(props.profileId),
  updateProfile: (patch) =>
    aiProfilesStore.updateProfile(props.profileId, patch),
  readSoul: () => aiProfilesStore.readSoul(props.profileId),
  writeSoul: (content) => aiProfilesStore.writeSoul(props.profileId, content),
  reportError: useRetryToast(),
})
const {
  name,
  temperatureText,
  maxOutputTokensText,
  stepCountText,
  temperatureError,
  maxOutputTokensError,
  stepCountError,
  soulPrompt,
  changeName,
  changeTemperature,
  changeMaxOutputTokens,
  changeStepCount,
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

onBeforeUnmount(() => {
  void editor.flush()
})

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

.vault-folder {
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}

.profile-folder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  width: 100%;
}

.advanced-toggle {
  display: flex;
  padding: var(--space-xs) var(--space-md);
  font-size: var(--text-control);
  color: var(--app-text-muted);
}
</style>
