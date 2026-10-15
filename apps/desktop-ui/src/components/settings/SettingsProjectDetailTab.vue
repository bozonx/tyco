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
        :disabled="!name.trim() || (isExternal && !targetPath.trim())"
        @click="handleSave"
      >
        {{ t('settings.saveProject') }}
      </Button>
    </div>

    <SettingsSection :title="t('settings.projectName')">
      <FieldRow :label="t('settings.projectName')">
        <FieldInput v-model="name" />
      </FieldRow>
      <FieldRow :label="t('settings.projectDescription')">
        <FieldInput v-model="description" />
      </FieldRow>
      <FieldRow :label="t('settings.projectType')">
        <SegmentedControl
          size="sm"
          :label="t('settings.projectType')"
          :model-value="isExternal ? 'external' : 'internal'"
          :options="projectTypeOptions"
          @update:model-value="isExternal = $event === 'external'"
        />
      </FieldRow>
      <FieldRow
        v-if="isExternal"
        :label="t('settings.projectTargetPath')"
        :info="targetPath || undefined"
      >
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-open-outline"
            @click="handlePickFolder"
          >
            {{ t('settings.selectFolder') }}
          </Button>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection v-if="!isNew" :title="t('settings.aiProfilesTab')">
      <div
        v-if="profiles.length === 0"
        class="text-sm text-base-content/50 italic"
      >
        {{ t('settings.noProfilesYet') }}
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="profile in profiles"
          :key="profile.id"
          class="flex items-center justify-between p-3 rounded-lg bg-base-200/40 border border-base-300/40"
        >
          <div class="flex items-center gap-2">
            <Icon
              :icon="profile.icon || 'mdi:account-outline'"
              height="18"
              class="text-primary shrink-0"
            />
            <span class="font-medium text-sm">{{ profile.name }}</span>
          </div>
          <div class="flex items-center gap-4 text-xs text-base-content/80">
            <span
              >{{ t('settings.accessRead') }}:
              {{
                formatAccess(profile.projectPermissions[props.projectId]?.read)
              }}</span
            >
            <span
              >{{ t('settings.accessWrite') }}:
              {{
                formatAccess(profile.projectPermissions[props.projectId]?.write)
              }}</span
            >
          </div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection v-if="!isNew" :title="t('settings.deleteProject')">
      <div
        class="p-4 rounded-lg border border-error/30 bg-error/5 flex items-center justify-between"
      >
        <div class="text-sm text-error/90">
          {{ t('settings.deleteProjectConfirm') }}
        </div>
        <Button
          size="sm"
          variant="danger"
          icon="mdi:trash-can-outline"
          @click="showDeleteConfirm = true"
        >
          {{ t('settings.deleteProject') }}
        </Button>
      </div>
    </SettingsSection>

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
import { computed, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { ProjectAccessMode } from '@tyco/shared'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'saved', id: string): void
}>()

const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()

const isNew = computed(() => props.projectId === 'new')
const name = ref('')
const description = ref('')
const isExternal = ref(false)
const targetPath = ref('')
const showDeleteConfirm = ref(false)

const profiles = aiProfilesStore.profiles

const projectTypeOptions = computed(() => [
  { id: 'internal', name: t('settings.projectTypeInternal') },
  { id: 'external', name: t('settings.projectTypeExternal') },
])

function formatAccess(mode?: ProjectAccessMode): string {
  if (mode === 'deny') return t('settings.accessDeny')
  if (mode === 'ask') return t('settings.accessAsk')
  return t('settings.accessAllow')
}

function loadProjectData() {
  if (isNew.value) {
    name.value = ''
    description.value = ''
    isExternal.value = false
    targetPath.value = ''
  } else {
    const project = aiProfilesStore.getProject(props.projectId)
    if (project) {
      name.value = project.name
      description.value = project.description || ''
      isExternal.value = project.isExternal
      targetPath.value = project.targetPath || ''
    }
  }
}

onMounted(loadProjectData)
watch(() => props.projectId, loadProjectData)

async function handlePickFolder() {
  try {
    const picked = await aiProfilesStore.pickExternalFolder()
    if (picked) {
      targetPath.value = picked
    }
  } catch (error) {
    toastText(String(error), 'error')
  }
}

async function handleSave() {
  if (!name.value.trim()) return
  if (isExternal.value && !targetPath.value.trim()) return
  try {
    if (isNew.value) {
      const created = await aiProfilesStore.createProject({
        name: name.value,
        description: description.value || undefined,
        isExternal: isExternal.value,
        targetPath: isExternal.value ? targetPath.value : null,
      })
      emit('saved', created.id)
    } else {
      const current = aiProfilesStore.getProject(props.projectId)
      if (current) {
        await aiProfilesStore.saveProject({
          ...current,
          name: name.value.trim(),
          description: description.value.trim() || undefined,
          isExternal: isExternal.value,
          targetPath: isExternal.value ? targetPath.value.trim() : null,
        })
        emit('saved', props.projectId)
      }
    }
  } catch (error) {
    toastText(String(error), 'error')
  }
}

async function handleDelete() {
  if (isNew.value) return
  try {
    await aiProfilesStore.deleteProject(props.projectId)
    showDeleteConfirm.value = false
    emit('back')
  } catch (error) {
    toastText(String(error), 'error')
  }
}
</script>
