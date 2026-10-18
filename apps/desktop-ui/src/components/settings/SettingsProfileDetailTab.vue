<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:arrow-left"
        @click="emit('back')"
      >
        {{ t('settings.aiProfilesOverview') }}
      </Button>
      <span
        v-if="!isNew && saveStatusText"
        class="text-xs"
        :class="hasSaveError ? 'text-error' : 'text-base-content/60'"
        role="status"
      >
        {{ saveStatusText }}
      </span>
    </div>

    <template v-if="isNew">
      <SettingsSection :title="t('settings.newProfile')">
        <form class="flex flex-col gap-3" @submit.prevent="handleCreate">
          <FieldRow :label="t('settings.profileName')">
            <FieldInput v-model="newName" />
          </FieldRow>
          <div class="flex justify-end">
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
        <div class="flex flex-col gap-2">
          <FieldTextArea
            v-model="soulPrompt"
            :rows="8"
            auto-resize
            :max-auto-height="400"
            :aria-label="t('settings.profileSoulPrompt')"
            @update:model-value="soulAutosave.schedule()"
          />
          <div class="flex justify-end">
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
        <div
          v-if="projects.length === 0"
          class="text-sm text-base-content/50 italic"
        >
          {{ t('settings.noProjectsYet') }}
        </div>
        <div v-else class="flex flex-col gap-3">
          <div
            v-for="project in projects"
            :key="project.id"
            class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-base-200/40 border border-base-300/40 gap-3"
          >
            <div class="flex items-center gap-2">
              <Icon
                :icon="
                  project.isExternal
                    ? 'mdi:folder-open-outline'
                    : 'mdi:folder-table-outline'
                "
                height="18"
                class="text-secondary shrink-0"
              />
              <span class="font-medium text-sm">{{ project.name }}</span>
            </div>
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <span class="text-xs text-base-content/70"
                  >{{ t('settings.accessRead') }}:</span
                >
                <SegmentedControl
                  size="sm"
                  :label="`${project.name} read`"
                  :model-value="getPermission(project.id).read"
                  :options="permissionOptions"
                  @update:model-value="
                    setPermission(
                      project.id,
                      'read',
                      $event as ProjectAccessMode
                    )
                  "
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-base-content/70"
                  >{{ t('settings.accessWrite') }}:</span
                >
                <SegmentedControl
                  size="sm"
                  :label="`${project.name} write`"
                  :model-value="getPermission(project.id).write"
                  :options="permissionOptions"
                  @update:model-value="
                    setPermission(
                      project.id,
                      'write',
                      $event as ProjectAccessMode
                    )
                  "
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection :title="t('settings.deleteProfile')">
        <div
          class="p-4 rounded-lg border border-error/30 bg-error/5 flex items-center justify-between gap-3"
        >
          <div class="text-sm text-error/90">
            {{ t('settings.deleteProfileHint') }}
          </div>
          <Button
            size="sm"
            variant="danger"
            icon="mdi:trash-can-outline"
            @click="askDelete"
          >
            {{ t('settings.deleteProfile') }}
          </Button>
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
import useToast from '../../composables/use-toast'
import {
  parseProfileMaxOutputTokens,
  parseProfileTemperature,
} from '../../lib/ai-profiles/profile-generation'
import { CHAT_TOOL_GROUPS } from '../../lib/chat-tools/chat-tool-groups'
import { chatModelOptions } from '../../lib/chat/chat-llm-selection'
import { createIpcChatSessionStorageDriver } from '../../lib/chat/chat-session-storage'
import { normalizeLlmConfig } from '../../lib/llm/llm-config'
import { isSecretUsable } from '../../lib/net/secrets'
import { createAutosave } from '../../lib/settings/autosave'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { disposeProfileChatStore } from '../../stores/chat'
import { useIpcStore } from '../../stores/ipc'
import { useSecretsStore } from '../../stores/secrets'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from '../common/SettingsSection.vue'
import SettingsProfileToolsSection from './SettingsProfileToolsSection.vue'
import {
  DEFAULT_PROJECT_PERMISSION,
  MAX_PROFILE_TEMPERATURE,
  type ProfileToolSettings,
  type ProjectAccessMode,
  type ProjectPermission,
} from '@tyco/shared'

const props = defineProps<{ profileId: string }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved', id: string): void
}>()

/** Autosave waits this long after the last keystroke */
const AUTOSAVE_DELAY_MS = 600
/** The select value of an unset model: the first usable one */
const DEFAULT_MODEL_OPTION = ''

const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()
const ipcStore = useIpcStore()
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
    emit('saved', created.id)
  } catch (error) {
    toastText(String(error), 'error')
  } finally {
    isCreating.value = false
  }
}

// ---------------------------------------------------------------------------
// Settings, each stored on its own a moment after it changes
// ---------------------------------------------------------------------------

const name = ref('')
const temperatureText = ref('')
const maxOutputTokensText = ref('')
const temperatureError = ref(false)
const maxOutputTokensError = ref(false)
const soulPrompt = ref('')
const isSoulLoaded = ref(false)

const profileAutosave = createAutosave({
  delayMs: AUTOSAVE_DELAY_MS,
  save: async () => {
    const temperature = parseProfileTemperature(temperatureText.value)
    const maxOutputTokens = parseProfileMaxOutputTokens(
      maxOutputTokensText.value
    )
    await aiProfilesStore.updateProfile(props.profileId, {
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
      ...(temperature.isValid ? { temperature: temperature.value } : {}),
      ...(maxOutputTokens.isValid
        ? { maxOutputTokens: maxOutputTokens.value }
        : {}),
    })
  },
})

const soulAutosave = createAutosave({
  delayMs: AUTOSAVE_DELAY_MS,
  save: async () => {
    // the field shows the file only once it has been read
    if (!isSoulLoaded.value) return
    await aiProfilesStore.writeSoul(props.profileId, soulPrompt.value)
  },
})

// the fields take the profile once it is there; the settings may open
// before the vault is read
watch(
  () => Boolean(profile.value),
  async (isThere) => {
    const current = profile.value
    if (!isThere || !current || isSoulLoaded.value) return
    name.value = current.name
    temperatureText.value = String(current.temperature ?? '')
    maxOutputTokensText.value = String(current.maxOutputTokens ?? '')
    try {
      soulPrompt.value = await aiProfilesStore.readSoul(current.id)
      isSoulLoaded.value = true
    } catch (error) {
      toastText(String(error), 'error')
    }
  },
  { immediate: true }
)

function changeName() {
  if (name.value.trim()) profileAutosave.schedule()
}

function changeTemperature(value: string) {
  temperatureText.value = value
  temperatureError.value = !parseProfileTemperature(value).isValid
  if (!temperatureError.value) profileAutosave.schedule()
}

function changeMaxOutputTokens(value: string) {
  maxOutputTokensText.value = value
  maxOutputTokensError.value = !parseProfileMaxOutputTokens(value).isValid
  if (!maxOutputTokensError.value) profileAutosave.schedule()
}

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
  chatModelOptions(
    normalizeLlmConfig(ipcStore.desktopState.userConfig?.llm),
    (id) => isSecretUsable(secretsStore.secrets, id)
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

const saveStatusText = computed(() => {
  const statuses = [profileAutosave.status.value, soulAutosave.status.value]
  if (statuses.includes('error')) return t('settings.profileSaveFailed')
  if (statuses.includes('saving') || statuses.includes('pending'))
    return t('settings.profileSaving')
  if (statuses.includes('saved')) return t('settings.profileSaved')
  return ''
})
const hasSaveError = computed(
  () =>
    profileAutosave.status.value === 'error' ||
    soulAutosave.status.value === 'error'
)

watch(
  () => profileAutosave.error.value || soulAutosave.error.value,
  (message) => {
    if (message) toastText(message, 'error')
  }
)

onBeforeUnmount(() => {
  void profileAutosave.flush()
  void soulAutosave.flush()
})

// ---------------------------------------------------------------------------
// Project permissions
// ---------------------------------------------------------------------------

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
  try {
    const chats = await createIpcChatSessionStorageDriver(
      ipcStore,
      props.profileId
    ).listChats()
    chatCount.value = chats.length
  } catch {
    chatCount.value = 0
  }
  showDeleteConfirm.value = true
}

async function handleDelete() {
  try {
    profileAutosave.cancel()
    soulAutosave.cancel()
    disposeProfileChatStore(props.profileId)
    await aiProfilesStore.deleteProfile(props.profileId)
    showDeleteConfirm.value = false
    emit('back')
  } catch (error) {
    toastText(String(error), 'error')
  }
}
</script>
