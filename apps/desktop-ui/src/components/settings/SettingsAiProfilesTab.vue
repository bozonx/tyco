<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.aiProfilesOverview')"
      :info="t('settings.aiVaultPathHint')"
    >
      <FieldRow
        :label="t('settings.aiVaultPath')"
        :hint="t('settings.aiVaultPathNotMoved')"
        :error="vaultError || undefined"
        :info="vaultPath"
      >
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-open-outline"
            @click="handleOpenVault"
          >
            {{ t('settings.openInFileManager') }}
          </Button>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-edit-outline"
            @click="handlePickVaultFolder"
          >
            {{ t('settings.selectFolder') }}
          </Button>
          <Button
            v-if="userConfig?.aiProfiles?.vaultPath"
            size="sm"
            variant="ghost"
            icon="mdi:restore"
            @click="handleResetVaultFolder"
          >
            {{ t('settings.resetToDefault') }}
          </Button>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.aiProfilesTab')">
      <div class="flex flex-col gap-3">
        <div class="text-sm text-base-content/70">
          {{ t('settings.profilesCount', { count: profiles.length }) }}
        </div>
        <div
          v-if="profiles.length === 0"
          class="text-sm text-base-content/50 italic"
        >
          {{ t('settings.noProfilesYet') }}
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            v-for="profile in profiles"
            :key="profile.id"
            class="flex items-center justify-between p-3 rounded-lg bg-base-200/50 border border-base-300/50 cursor-pointer hover:bg-base-200 transition-colors"
            @click="emit('navigate', `ai-profile:${profile.id}`)"
          >
            <div class="flex items-center gap-2.5 truncate">
              <Icon
                icon="mdi:account-outline"
                height="18"
                class="text-primary shrink-0"
              />
              <span class="font-medium truncate">{{ profile.name }}</span>
            </div>
            <Icon
              icon="mdi:chevron-right"
              height="18"
              class="text-base-content/40 shrink-0"
            />
          </div>
        </div>
        <div>
          <Button
            size="sm"
            variant="primary"
            icon="mdi:plus"
            @click="emit('navigate', 'ai-profile:new')"
          >
            {{ t('settings.newProfile') }}
          </Button>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="IS_AI_PROJECTS_ENABLED"
      :title="t('settings.projectPermissions')"
    >
      <div class="flex flex-col gap-3">
        <div class="text-sm text-base-content/70">
          {{ t('settings.projectsCount', { count: projects.length }) }}
        </div>
        <div
          v-if="projects.length === 0"
          class="text-sm text-base-content/50 italic"
        >
          {{ t('settings.noProjectsYet') }}
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            v-for="project in projects"
            :key="project.id"
            class="flex items-center justify-between p-3 rounded-lg bg-base-200/50 border border-base-300/50 cursor-pointer hover:bg-base-200 transition-colors"
            @click="emit('navigate', `ai-project:${project.id}`)"
          >
            <div class="flex items-center gap-2.5 truncate">
              <Icon
                :icon="
                  project.isExternal
                    ? 'mdi:folder-open-outline'
                    : 'mdi:folder-table-outline'
                "
                height="18"
                class="text-secondary shrink-0"
              />
              <span class="font-medium truncate">{{ project.name }}</span>
            </div>
            <Icon
              icon="mdi:chevron-right"
              height="18"
              class="text-base-content/40 shrink-0"
            />
          </div>
        </div>
        <div>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:plus"
            @click="emit('navigate', 'ai-project:new')"
          >
            {{ t('settings.newProject') }}
          </Button>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { IS_AI_PROJECTS_ENABLED } from '../../lib/ai-profiles/ai-projects-feature'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { UserConfig } from '@tyco/shared'

defineProps<{ userConfig?: UserConfig }>()
const emit = defineEmits<{
  (e: 'navigate', tab: string): void
  (e: 'update:vaultPath', path: string | undefined): void
}>()
const { t } = useI18n()
const { toastText } = useToast()
const aiProfilesStore = useAiProfilesStore()

const profiles = computed(() => aiProfilesStore.profiles)
const projects = computed(() => aiProfilesStore.projects)
const vaultPath = computed(() => aiProfilesStore.vaultPath)
const vaultError = computed(() => aiProfilesStore.vaultError)

onMounted(() => {
  void aiProfilesStore.loadAll()
})

async function handleOpenVault() {
  try {
    await aiProfilesStore.openVaultDir()
  } catch (error) {
    toastText(String(error), 'error')
  }
}

// the store reads the vault anew once the settings with the path are stored
async function handlePickVaultFolder() {
  try {
    const selected = await aiProfilesStore.pickFolder()
    if (selected) emit('update:vaultPath', selected)
  } catch (error) {
    toastText(String(error), 'error')
  }
}

function handleResetVaultFolder() {
  emit('update:vaultPath', undefined)
}
</script>
