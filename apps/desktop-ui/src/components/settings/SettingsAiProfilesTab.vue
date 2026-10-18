<template>
  <div class="settings-stack">
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
        <div class="vault-actions">
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
            v-if="userConfig.aiProfiles?.vaultPath"
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
      <div class="settings-section-content">
        <p class="settings-entity-meta">
          {{ t('settings.profilesCount', { count: profiles.length }) }}
        </p>
        <StateMessage
          v-if="profiles.length === 0"
          density="compact"
          :message="t('settings.noProfilesYet')"
        />
        <div v-else class="entity-grid">
          <SettingsEntityItem
            v-for="profile in profiles"
            :key="profile.id"
            icon="mdi:account-outline"
            icon-tone="primary"
            :title="profile.name"
            openable
            @open="navigate(profileTab(profile.id))"
          />
        </div>
        <div>
          <Button
            size="sm"
            variant="primary"
            icon="mdi:plus"
            @click="navigate(profileTab(NEW_ENTITY_ID))"
          >
            {{ t('settings.newProfile') }}
          </Button>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.projectPermissions')">
      <div class="settings-section-content">
        <p class="settings-entity-meta">
          {{ t('settings.projectsCount', { count: projects.length }) }}
        </p>
        <StateMessage
          v-if="projects.length === 0"
          density="compact"
          :message="t('settings.noProjectsYet')"
        />
        <div v-else class="entity-grid">
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
            openable
            @open="navigate(projectTab(project.id))"
          />
        </div>
        <div>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:plus"
            @click="navigate(projectTab(NEW_ENTITY_ID))"
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
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  NEW_ENTITY_ID,
  profileTab,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, operations, navigate } = useSettingsContext()
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
    if (selected) operations.updateVaultPath(selected)
  } catch (error) {
    toastText(String(error), 'error')
  }
}

function handleResetVaultFolder() {
  operations.updateVaultPath(undefined)
}
</script>

<style scoped>
.vault-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.entity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-sm);
}
</style>
