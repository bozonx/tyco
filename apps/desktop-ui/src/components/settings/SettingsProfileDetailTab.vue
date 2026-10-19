<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.aiProfilesOverview')"
      @back="navigate(AI_OVERVIEW_TAB)"
    >
      <SettingsAutosaveStatus v-if="!isNew" :status="editor.saveStatus.value" />
    </SettingsDetailHeader>

    <template v-if="isNew">
      <SettingsSection :title="t('settings.newProfile')">
        <form class="profile-create-form" @submit.prevent="handleCreate">
          <FieldRow :label="t('settings.profileName')">
            <FieldInput v-model="newName" />
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
      <SettingsSection :title="t('settings.profileName')">
        <FieldRow
          :label="t('settings.profileName')"
          :error="name.trim() ? undefined : t('settings.profileNameRequired')"
        >
          <FieldInput v-model="name" @update:model-value="changeName" />
        </FieldRow>
      </SettingsSection>

      <SettingsSection
        :title="t('settings.profileGeneration')"
        :info="t('settings.profileGenerationHint')"
      >
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
        @update="changeTools"
      />

      <SettingsSection
        :title="t('settings.profileSoulPrompt')"
        :info="t('settings.profileSoulPromptHint')"
      >
        <div class="settings-section-content">
          <FieldTextArea
            v-model="soulPrompt"
            :rows="8"
            auto-resize
            :max-auto-height="400"
            :aria-label="t('settings.profileSoulPrompt')"
            @update:model-value="changeSoul"
          />
          <div class="profile-form-actions">
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

      <SettingsSection
        :title="t('settings.projectPermissions')"
        :info="t('settings.projectPermissionsHint')"
      >
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
              :icon="
                project.isExternal
                  ? 'mdi:folder-open-outline'
                  : 'mdi:folder-table-outline'
              "
              icon-tone="secondary"
              :title="project.name"
            >
              <span
                v-for="kind in PERMISSION_KINDS"
                :key="kind"
                class="profile-permission"
              >
                <span class="settings-entity-meta">{{
                  t(PERMISSION_LABEL_KEYS[kind])
                }}</span>
                <SegmentedControl
                  size="sm"
                  :label="`${project.name}: ${t(PERMISSION_LABEL_KEYS[kind])}`"
                  :model-value="getPermission(project.id)[kind]"
                  :options="permissionOptions"
                  @update:model-value="
                    setPermission(project.id, kind, $event as ProjectAccessMode)
                  "
                />
              </span>
            </SettingsEntityItem>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { createProfileEditor } from '../../lib/ai-profiles/profile-editor'
import { CHAT_TOOL_GROUPS } from '../../lib/chat-tools/chat-tool-groups'
import { chatModelOptions } from '../../lib/chat/chat-llm-selection'
import { normalizeLlmConfig } from '../../lib/llm/llm-config'
import { isSecretUsable } from '../../lib/net/secrets'
import {
  AI_OVERVIEW_TAB,
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
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsAutosaveStatus from './SettingsAutosaveStatus.vue'
import SettingsDangerZone from './SettingsDangerZone.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'
import SettingsSection from './SettingsSection.vue'
import {
  DEFAULT_PROJECT_PERMISSION,
  MAX_PROFILE_TEMPERATURE,
  type ProfileToolSettings,
  type ProjectAccessMode,
  type ProjectPermission,
  llmSecretId,
} from '@tyco/shared'

const props = defineProps<{ profileId: string }>()
const { navigate } = useSettingsContext()

/** Autosave waits this long after the last keystroke */
const AUTOSAVE_DELAY_MS = 600
/** The select value of an unset model: the first usable one */
const DEFAULT_MODEL_OPTION = ''

const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()
const desktopStore = useDesktopStore()
const secretsStore = useSecretsStore()

const isNew = computed(() => props.profileId === 'new')
const profile = computed(() => aiProfilesStore.getProfile(props.profileId))
const projects = computed(() => aiProfilesStore.projects)

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const newName = ref('')
const isCreating = ref(false)

async function handleCreate() {
  if (!newName.value.trim() || isCreating.value) return
  isCreating.value = true
  try {
    const created = await aiProfilesStore.createProfile({
      name: newName.value,
      soul: t('settings.profileDefaultSoul'),
    })
    navigate(profileTab(created.id))
  } catch (error) {
    toastText(String(error), 'error')
  } finally {
    isCreating.value = false
  }
}

// ---------------------------------------------------------------------------
// Settings, each stored on its own a moment after it changes
// ---------------------------------------------------------------------------

const editor = createProfileEditor({
  delayMs: AUTOSAVE_DELAY_MS,
  updateProfile: (patch) =>
    aiProfilesStore.updateProfile(props.profileId, patch),
  readSoul: () => aiProfilesStore.readSoul(props.profileId),
  writeSoul: (content) => aiProfilesStore.writeSoul(props.profileId, content),
  reportError: (message) => toastText(message, 'error'),
})
const {
  name,
  temperatureText,
  maxOutputTokensText,
  temperatureError,
  maxOutputTokensError,
  soulPrompt,
  changeName,
  changeTemperature,
  changeMaxOutputTokens,
  changeSoul,
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

function changeModel(value: string | number | undefined) {
  const modelId = value ? String(value) : undefined
  void aiProfilesStore
    .updateProfile(props.profileId, { modelId })
    .catch((error: unknown) => toastText(String(error), 'error'))
}

function changeTools(tools: ProfileToolSettings) {
  void aiProfilesStore
    .updateProfile(props.profileId, { tools })
    .catch((error: unknown) => toastText(String(error), 'error'))
}

const availableModels = computed(() =>
  chatModelOptions(normalizeLlmConfig(desktopStore.userConfig?.llm), (id) =>
    isSecretUsable(secretsStore.secrets, llmSecretId(id))
  )
)

const modelOptions = computed(() => {
  const options = [
    { id: DEFAULT_MODEL_OPTION, name: t('settings.profileModelDefault') },
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
// Project permissions
// ---------------------------------------------------------------------------

const PERMISSION_KINDS = [
  'read',
  'write',
] as const satisfies readonly (keyof ProjectPermission)[]
const PERMISSION_LABEL_KEYS = {
  read: 'settings.accessRead',
  write: 'settings.accessWrite',
} as const

const permissionOptions = computed(() => [
  { id: 'deny', name: t('settings.accessDeny') },
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

function getPermission(projectId: string): ProjectPermission {
  return (
    profile.value?.projectPermissions[projectId] ?? DEFAULT_PROJECT_PERMISSION
  )
}

function setPermission(
  projectId: string,
  access: keyof ProjectPermission,
  mode: ProjectAccessMode
) {
  void aiProfilesStore
    .setProjectPermission(props.profileId, projectId, {
      ...getPermission(projectId),
      [access]: mode,
    })
    .catch((error: unknown) => toastText(String(error), 'error'))
}

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
const chatCount = ref(0)
const deleteMessage = computed(() =>
  t('settings.deleteProfileConfirm', {
    name: profile.value?.name ?? '',
    count: chatCount.value,
  })
)

async function askDelete() {
  chatCount.value = await aiProfilesStore
    .countChats(props.profileId)
    .catch(() => 0)
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

.profile-permission {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
