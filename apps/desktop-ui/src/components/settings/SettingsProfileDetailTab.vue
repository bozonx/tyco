<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:arrow-left"
        @click="emit('back')"
      >
        {{ t('settings.aiProfilesOverview') }}
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon="mdi:content-save"
        :disabled="!name.trim()"
        @click="handleSave"
      >
        {{ t('settings.saveProfile') }}
      </Button>
    </div>

    <SettingsSection :title="t('settings.profileName')">
      <FieldRow :label="t('settings.profileName')">
        <FieldInput v-model="name" />
      </FieldRow>
      <FieldRow :label="t('settings.profileIcon')" info="mdi:*">
        <FieldInput v-model="icon" placeholder="mdi:account-outline" />
      </FieldRow>
    </SettingsSection>

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
        />
        <div v-if="!isNew" class="flex justify-end">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:file-document-outline"
            @click="handleOpenSoul"
          >
            {{ t('settings.openSoulFile') }}
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
                  setReadPermission(project.id, $event as ProjectAccessMode)
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
                  setWritePermission(project.id, $event as ProjectAccessMode)
                "
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection v-if="!isNew" :title="t('settings.deleteProfile')">
      <div
        class="p-4 rounded-lg border border-error/30 bg-error/5 flex items-center justify-between"
      >
        <div class="text-sm text-error/90">
          {{ t('settings.deleteProfileConfirm') }}
        </div>
        <Button
          size="sm"
          variant="danger"
          icon="mdi:trash-can-outline"
          @click="showDeleteConfirm = true"
        >
          {{ t('settings.deleteProfile') }}
        </Button>
      </div>
    </SettingsSection>

    <ConfirmModal
      :open="showDeleteConfirm"
      :title="t('settings.deleteProfile')"
      :message="t('settings.deleteProfileConfirm')"
      :confirm-text="t('settings.deleteProfile')"
      danger
      @confirm="handleDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { ProjectAccessMode, ProjectPermission } from '@tyco/shared'

const props = defineProps<{ profileId: string }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved', id: string): void
}>()

const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()

const isNew = computed(() => props.profileId === 'new')
const name = ref('')
const icon = ref('')
const soulPrompt = ref('')
const permissions = ref<Record<string, ProjectPermission>>({})
const showDeleteConfirm = ref(false)

const projects = aiProfilesStore.projects

const permissionOptions = computed(() => [
  { id: 'deny', name: t('settings.accessDeny') },
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

function getPermission(projectId: string): ProjectPermission {
  return permissions.value[projectId] || { read: 'allow', write: 'ask' }
}

function setReadPermission(projectId: string, mode: ProjectAccessMode) {
  const current = getPermission(projectId)
  permissions.value = {
    ...permissions.value,
    [projectId]: { ...current, read: mode },
  }
}

function setWritePermission(projectId: string, mode: ProjectAccessMode) {
  const current = getPermission(projectId)
  permissions.value = {
    ...permissions.value,
    [projectId]: { ...current, write: mode },
  }
}

async function loadProfileData() {
  if (isNew.value) {
    name.value = ''
    icon.value = ''
    soulPrompt.value = '# System Prompt\nYou are a helpful AI assistant.\n'
    permissions.value = {}
  } else {
    const profile = aiProfilesStore.getProfile(props.profileId)
    if (profile) {
      name.value = profile.name
      icon.value = profile.icon || ''
      permissions.value = { ...profile.projectPermissions }
      soulPrompt.value = await aiProfilesStore.readSoul(props.profileId)
    }
  }
}

onMounted(loadProfileData)
watch(() => props.profileId, loadProfileData)

async function handleSave() {
  if (!name.value.trim()) return
  try {
    if (isNew.value) {
      const created = await aiProfilesStore.createProfile({
        name: name.value,
        icon: icon.value || undefined,
        projectPermissions: permissions.value,
      })
      await aiProfilesStore.writeSoul(created.id, soulPrompt.value)
      emit('saved', created.id)
    } else {
      const current = aiProfilesStore.getProfile(props.profileId)
      if (current) {
        await aiProfilesStore.saveProfile({
          ...current,
          name: name.value.trim(),
          icon: icon.value.trim() || undefined,
          projectPermissions: permissions.value,
        })
        await aiProfilesStore.writeSoul(props.profileId, soulPrompt.value)
        emit('saved', props.profileId)
      }
    }
  } catch (error) {
    toastText(String(error), 'error')
  }
}

async function handleOpenSoul() {
  if (isNew.value) return
  try {
    const vaultPath = await aiProfilesStore.getVaultPath()
    const soulPath = `${vaultPath}/profiles/${props.profileId}`
    await aiProfilesStore.openFolder(soulPath)
  } catch (error) {
    toastText(String(error), 'error')
  }
}

async function handleDelete() {
  if (isNew.value) return
  try {
    await aiProfilesStore.deleteProfile(props.profileId)
    showDeleteConfirm.value = false
    emit('back')
  } catch (error) {
    toastText(String(error), 'error')
  }
}
</script>
