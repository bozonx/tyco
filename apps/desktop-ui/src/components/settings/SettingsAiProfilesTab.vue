<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.aiProfilesTab')"
      :info="t('settings.aiProfilesHint')"
    >
      <div class="settings-section-content">
        <StateMessage
          v-if="profiles.length === 0"
          density="compact"
          :message="t('settings.noProfilesYet')"
        />
        <div v-else class="entity-grid">
          <SettingsEntityItem
            v-for="profile in profiles"
            :key="profile.id"
            :icon="profileIcon(profile)"
            icon-tone="primary"
            :title="profile.name"
            :description="describeProfile(profile)"
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

    <SettingsSection
      :title="t('settings.projectsTitle')"
      :info="t('settings.projectsHint')"
    >
      <div class="settings-section-content">
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
            :description="project.description || undefined"
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

    <SettingsChatHistorySection scope="profiles" />

    <SettingsSection
      :title="t('settings.aiVaultTitle')"
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
            v-if="userConfig.aiVault.path"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useChatModelOptions } from '../../composables/use-chat-model-options'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { profileIcon } from '../../lib/ai-profiles/profile-icons'
import { profileModelName } from '../../lib/ai-profiles/profile-model-options'
import {
  CHAT_TOOL_GROUPS,
  toolGroupSettings,
} from '../../lib/chat-tools/chat-tool-groups'
import {
  NEW_ENTITY_ID,
  profileTab,
  projectTab,
} from '../../lib/settings/settings-navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import type { AiProfile } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, operations, navigate } = useSettingsContext()
const { toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()

const profiles = computed(() => aiProfilesStore.profiles)
const projects = computed(() => aiProfilesStore.projects)
const vaultPath = computed(() => aiProfilesStore.vaultPath)
const vaultError = computed(() => aiProfilesStore.vaultError)

const availableModels = useChatModelOptions()

/** The model of a profile and the tools it may use, in one line */
function describeProfile(profile: AiProfile): string {
  const model = profileModelName(availableModels.value, profile.modelId, t)
  const tools = CHAT_TOOL_GROUPS.filter(
    (group) => toolGroupSettings(profile.tools, group).isEnabled
  ).map((group) => t(group.labelKey))
  return [model, ...tools].join(' · ')
}

onMounted(() => {
  void aiProfilesStore.loadAll()
})

async function handleOpenVault() {
  try {
    await aiProfilesStore.openVaultDir()
  } catch (error) {
    toastError(error)
  }
}

// the store reads the vault anew once the settings with the path are stored
async function handlePickVaultFolder() {
  try {
    const selected = await aiProfilesStore.pickFolder()
    if (selected) operations.updateVaultPath(selected)
  } catch (error) {
    toastError(error)
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
