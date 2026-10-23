<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.aiProfilesTab')"
      @back="navigate(AI_OVERVIEW_TAB)"
    >
      <template v-if="profile && !isNew">
        <SettingsAutosaveStatus :status="editor.saveStatus.value" />
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:content-copy"
          :disabled="isDuplicating"
          @click="handleDuplicate"
        >
          {{ t('settings.duplicateProfile') }}
        </Button>
      </template>
    </SettingsDetailHeader>

    <template v-if="isNew">
      <SettingsSection :title="t('settings.newProfile')">
        <form class="profile-create-form" @submit.prevent="handleCreate">
          <FieldRow :label="t('settings.profileName')">
            <FieldInput v-model="newName" />
          </FieldRow>
          <FieldRow :label="t('settings.profileIcon')">
            <ProfileIconPicker
              v-model="newIcon"
              :label="t('settings.profileIcon')"
            />
          </FieldRow>
          <div class="profile-form-actions">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon="mdi:plus"
              :disabled="!newName.trim() || isCreating"
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
        <FieldRow :label="t('settings.profileIcon')">
          <ProfileIconPicker
            :model-value="profileIcon(profile)"
            :label="t('settings.profileIcon')"
            @update:model-value="changeSettings({ icon: $event })"
          />
        </FieldRow>
        <FieldRow :label="t('settings.profileModel')">
          <FieldSelect
            :model-value="profile.modelId ?? DEFAULT_MODEL_OPTION"
            :options="modelOptions"
            @update:model-value="changeModel"
          />
        </FieldRow>
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
            maxOutputTokensError ? t('settings.numberTokensInvalid') : undefined
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
          <template v-if="group.id === FILES_TOOL_GROUP_ID">
            <p class="settings-entity-meta">
              {{ t('settings.projectPermissionsHint') }}
            </p>
            <InlineNotice
              v-if="settings.access === 'ask'"
              density="compact"
              icon="mdi:information-outline"
              :message="t('settings.profileFilesAskAll')"
            />
            <SettingsProfileProjectAccess
              :projects="projects"
              :permissions="profile.projectPermissions"
              @change="setPermission"
            />
          </template>
        </template>
      </SettingsProfileToolsSection>

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
          <div class="profile-form-actions">
            <Button
              v-if="editor.soulLoadError.value"
              size="sm"
              :disabled="editor.isSoulLoading.value"
              @click="editor.loadSoul()"
            >
              {{ t('common.retry') }}
            </Button>
            <Button
              size="sm"
              variant="neutral"
              icon="mdi:folder-open-outline"
              @click="handleOpenFolder"
            >
              {{ t('settings.openProfileFolder') }}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection :title="t('settings.deleteProfile')">
        <div class="settings-section-content">
          <SettingsDangerZone
            :message="t('settings.deleteProfileHint')"
            :action-label="t('settings.deleteProfile')"
            @action="askDelete"
          />
        </div>
      </SettingsSection>
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

    <ConfirmModal
      :open="showDeleteConfirm"
      :title="t('settings.deleteProfile')"
      :message="deleteMessage"
      :confirm-text="t('settings.deleteProfile')"
      danger
      @confirm="handleDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { createProfileEditor } from '../../lib/ai-profiles/profile-editor'
import {
  DEFAULT_PROFILE_ICON,
  profileIcon,
} from '../../lib/ai-profiles/profile-icons'
import {
  CHAT_TOOL_GROUPS,
  FILES_TOOL_GROUP_ID,
} from '../../lib/chat-tools/chat-tool-groups'
import { chatModelOptions } from '../../lib/chat/chat-llm-selection'
import { normalizeLlmConfig } from '../../lib/llm/llm-config'
import { isSecretUsable } from '../../lib/net/secrets'
import {
  AI_OVERVIEW_TAB,
  NEW_ENTITY_ID,
  profileTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { useSecretsStore } from '../../stores/secrets'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import ProfileIconPicker from './ProfileIconPicker.vue'
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDangerZone from './SettingsDangerZone.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsProfileProjectAccess from './SettingsProfileProjectAccess.vue'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'
import SettingsSection from './SettingsSection.vue'
import {
  MAX_PROFILE_TEMPERATURE,
  type ProjectPermission,
  llmSecretId,
} from '@tyco/shared'

const props = defineProps<{ profileId: string }>()
const { navigate } = useSettingsContext()

/** The select value of an unset model: the first usable one */
const DEFAULT_MODEL_OPTION = ''

const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()
const desktopStore = useDesktopStore()
const secretsStore = useSecretsStore()

const isNew = computed(() => props.profileId === NEW_ENTITY_ID)
const profile = computed(() => aiProfilesStore.getProfile(props.profileId))
const projects = computed(() => aiProfilesStore.projects)

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const newName = ref('')
const newIcon = ref(DEFAULT_PROFILE_ICON)
const isCreating = ref(false)

async function handleCreate() {
  if (!newName.value.trim() || isCreating.value) return
  isCreating.value = true
  try {
    const created = await aiProfilesStore.createProfile({
      name: newName.value,
      soul: t('settings.profileDefaultSoul'),
      settings:
        newIcon.value === DEFAULT_PROFILE_ICON ? {} : { icon: newIcon.value },
    })
    navigate(profileTab(created.id))
  } catch (error) {
    toastText(String(error), 'error')
  } finally {
    isCreating.value = false
  }
}

const isDuplicating = ref(false)

async function handleDuplicate() {
  if (!profile.value || isDuplicating.value) return
  isDuplicating.value = true
  try {
    // the copy takes the instruction as typed, not only as stored
    await editor.flush()
    const copy = await aiProfilesStore.duplicateProfile(
      props.profileId,
      t('settings.profileCopyName', { name: profile.value.name })
    )
    navigate(profileTab(copy.id))
  } catch (error) {
    toastText(String(error), 'error')
  } finally {
    isDuplicating.value = false
  }
}

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
  reportError: (message, retry) =>
    toastText(message, 'error', {
      action: { label: t('common.retry'), run: retry },
    }),
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

function changeModel(value: string | number | undefined) {
  void changeSettings({ modelId: value ? String(value) : undefined })
}

function setPermission(projectId: string, permission: ProjectPermission) {
  if (!profile.value) return
  void changeSettings({
    projectPermissions: {
      ...profile.value.projectPermissions,
      [projectId]: permission,
    },
  })
}

const availableModels = computed(() =>
  chatModelOptions(normalizeLlmConfig(desktopStore.userConfig?.llm), (id) =>
    isSecretUsable(secretsStore.secrets, llmSecretId(id))
  )
)

const modelOptions = computed(() => {
  const firstModel = availableModels.value[0]
  const options = [
    {
      id: DEFAULT_MODEL_OPTION,
      name: firstModel
        ? t('settings.profileModelDefaultNamed', { model: firstModel.name })
        : t('settings.profileModelDefault'),
    },
    ...availableModels.value.map((option) => ({
      id: option.id,
      name: option.name,
      group: option.providerLabel,
    })),
  ]
  const modelId = profile.value?.modelId
  // a model removed or left without a key stays visible as picked
  if (modelId && !availableModels.value.some((m) => m.id === modelId)) {
    options.push({
      id: modelId,
      name: `${modelId} (${t('settings.profileModelUnavailable')})`,
    })
  }
  return options
})

onBeforeUnmount(() => {
  void editor.flush()
})

// ---------------------------------------------------------------------------
// Folder and removal
// ---------------------------------------------------------------------------

async function handleOpenFolder() {
  try {
    await aiProfilesStore.openVaultDir(props.profileId)
  } catch (error) {
    toastText(String(error), 'error')
  }
}

const showDeleteConfirm = ref(false)
/** Unknown when the chats could not be counted */
const chatCount = ref<number | null>(null)
const deleteMessage = computed(() => {
  const profileName = profile.value?.name ?? ''
  return chatCount.value === null
    ? t('settings.deleteProfileConfirmUncounted', { name: profileName })
    : t('settings.deleteProfileConfirm', {
        name: profileName,
        count: chatCount.value,
      })
})

async function askDelete() {
  chatCount.value = await aiProfilesStore
    .countChats(props.profileId)
    .catch(() => null)
  showDeleteConfirm.value = true
}

async function handleDelete() {
  try {
    editor.cancel()
    await aiProfilesStore.deleteProfile(props.profileId)
    showDeleteConfirm.value = false
    navigate(AI_OVERVIEW_TAB)
  } catch (error) {
    toastText(String(error), 'error')
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
