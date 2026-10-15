<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.aiProfilesOverview')"
      :info="t('settings.aiVaultPathHint')"
    >
      <FieldRow :label="t('settings.aiVaultPath')" :info="vaultPath">
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:folder-open-outline"
            @click="handleOpenVault"
          >
            {{ t('settings.openInFileManager') }}
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
                :icon="profile.icon || 'mdi:account-outline'"
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

    <SettingsSection :title="t('settings.projectPermissions')">
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
import { onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'

const emit = defineEmits<{ (e: 'navigate', tab: string): void }>()
const { t } = useI18n()
const aiProfilesStore = useAiProfilesStore()

const vaultPath = ref('')
const { profiles, projects } = aiProfilesStore

onMounted(async () => {
  await aiProfilesStore.loadAll()
  vaultPath.value = await aiProfilesStore.getVaultPath()
})

async function handleOpenVault() {
  if (vaultPath.value) {
    await aiProfilesStore.openFolder(vaultPath.value)
  }
}
</script>
