<template>
  <div class="settings-panel">
    <aside class="settings-nav">
      <div class="settings-nav-title">{{ t('nav.settings') }}</div>
      <template v-for="group in navigation" :key="group.id">
        <div v-if="group.label" class="settings-nav-category">
          {{ group.label }}
        </div>
        <NavigationList
          :label="group.label ?? t('nav.settings')"
          :items="group.items"
          :model-value="currentNavigationItemId ?? ''"
          @update:model-value="currentTab = String($event)"
        />
      </template>
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <h1 v-if="showPageTitle" class="settings-page-title">
          <span>{{ currentTabTitle }}</span>
        </h1>

        <SettingsSaveStatus
          :config-is-newer="configIsNewer"
          :is-saving="isSaving"
          :is-reloading="isReloading"
          :save-error="saveError"
          :conflicts="conflictTitles"
          @reload="reloadSettings"
          @keep-mine="resolveConflicts('mine')"
          @use-theirs="resolveConflicts('theirs')"
          @retry="session.persist()"
        />

        <fieldset
          :key="`${session.reloadCount}:${configIsNewer}`"
          class="settings-fields"
          :disabled="configIsNewer || isReloading"
          :inert="configIsNewer || isReloading"
        >
          <template v-if="current.kind === 'section'">
            <SettingsCommandsTab
              v-if="current.id === 'commands'"
              :key="focusCommandId"
              :focus-command-id="focusCommandId"
            />
            <SettingsVariablesTab
              v-else-if="current.id === 'variables'"
              :key="focusVariableId"
              :focus-variable-id="focusVariableId"
            />
            <component :is="SECTION_TABS[current.id]" v-else />
          </template>
          <SettingsAiProfilesTab v-else-if="current.kind === 'ai-overview'" />
          <SettingsPluginDetailTab
            v-else-if="currentPlugin"
            :key="currentPlugin.pluginId"
            :plugin="currentPlugin"
          />
          <SettingsProfileDetailTab
            v-else-if="current.kind === 'ai-profile'"
            :key="currentTab"
            :profile-id="current.profileId"
          />
          <SettingsProjectDetailTab
            v-else-if="current.kind === 'ai-project'"
            :key="currentTab"
            :project-id="current.projectId"
          />
        </fieldset>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
/** The activation whose settings tab was last opened */
let lastSettingsTabActivationId: number | undefined
</script>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import {
  type Component,
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import {
  getNavigatorLanguages,
  resolveUiLanguagePreference,
} from '../../lib/locale/language'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import { SETTINGS_CONTEXT_KEY } from '../../lib/settings/settings-context'
import {
  DEFAULT_SETTINGS_TAB,
  type SettingsPageSectionId,
  buildSettingsNavigation,
  hasSettingsPageTitle,
  isSettingsTabAvailable,
  parseSettingsTab,
  settingsNavigationItemId,
  settingsTabTitle,
  settingsTitlesOfConfigPaths,
} from '../../lib/settings/settings-navigation'
import { createSettingsOperations } from '../../lib/settings/settings-operations'
import { deviceVariableValues } from '../../lib/variables/command-variables'
import { appNavigation } from '../../navigation'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { usePluginRuntimeStore } from '../../stores/plugin-runtime'
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
import NavigationList from '../common/NavigationList.vue'
import SettingsAccessibilityTab from './SettingsAccessibilityTab.vue'
import SettingsAiProfilesTab from './SettingsAiProfilesTab.vue'
import SettingsChatPromptsTab from './SettingsChatPromptsTab.vue'
import SettingsChatTab from './SettingsChatTab.vue'
import SettingsCommandsTab from './SettingsCommandsTab.vue'
import SettingsCorrectionTab from './SettingsCorrectionTab.vue'
import SettingsEditorTab from './SettingsEditorTab.vue'
import SettingsFavoritesTab from './SettingsFavoritesTab.vue'
import SettingsGeneralTab from './SettingsGeneralTab.vue'
import SettingsGlobalActionsTab from './SettingsGlobalActionsTab.vue'
import SettingsHistoryTab from './SettingsHistoryTab.vue'
import SettingsLanguagesTab from './SettingsLanguagesTab.vue'
import SettingsLlmTab from './SettingsLlmTab.vue'
import SettingsMainActionsTab from './SettingsMainActionsTab.vue'
import SettingsPluginDetailTab from './SettingsPluginDetailTab.vue'
import SettingsPluginsTab from './SettingsPluginsTab.vue'
import SettingsProfileDetailTab from './SettingsProfileDetailTab.vue'
import SettingsProjectDetailTab from './SettingsProjectDetailTab.vue'
import SettingsSaveStatus from './SettingsSaveStatus.vue'
import SettingsStylingTab from './SettingsStylingTab.vue'
import SettingsTransformationsTab from './SettingsTransformationsTab.vue'
import SettingsTranslationsTab from './SettingsTranslationsTab.vue'
import SettingsVariablesTab from './SettingsVariablesTab.vue'
import SettingsVoiceTab from './SettingsVoiceTab.vue'

/** The sections without a parameter; each edits the draft from the context */
const SECTION_TABS: Record<
  Exclude<SettingsPageSectionId, 'commands'>,
  Component
> = {
  general: SettingsGeneralTab,
  editor: SettingsEditorTab,
  history: SettingsHistoryTab,
  'global-actions': SettingsGlobalActionsTab,
  stt: SettingsVoiceTab,
  chat: SettingsChatTab,
  correction: SettingsCorrectionTab,
  llm: SettingsLlmTab,
  translations: SettingsTranslationsTab,
  accessibility: SettingsAccessibilityTab,
  variables: SettingsVariablesTab,
  plugins: SettingsPluginsTab,
  'main-actions': SettingsMainActionsTab,
  transformations: SettingsTransformationsTab,
  styling: SettingsStylingTab,
  'chat-prompts': SettingsChatPromptsTab,
  favorites: SettingsFavoritesTab,
  languages: SettingsLanguagesTab,
}

const { pluginFactories, pluginRuntimeStates } = usePluginRuntimeStore()
const secretsStore = useSecretsStore()
const aiProfilesStore = useAiProfilesStore()
const { t } = useI18n()
const { toastError } = useToast()

onMounted(() => {
  void aiProfilesStore.loadAll()
})

const route = useRoute()
// another page may open the settings on a tab of its own
const requestedTab = route?.query.tab
const currentTab = ref<string>(
  typeof requestedTab === 'string' && requestedTab
    ? requestedTab
    : DEFAULT_SETTINGS_TAB
)
const current = computed(() => parseSettingsTab(currentTab.value))

// an activation may open the settings on a tab, e.g. from the prompt menu of
// the quick window; each activation applies once, the page may mount later
const desktopStore = useDesktopStore()
watch(
  () => desktopStore.desktopState.activationId,
  (activationId) => {
    const { mode, settingsTab } = desktopStore.desktopState
    if (mode !== 'config' || !settingsTab) return
    if (activationId === lastSettingsTabActivationId) return
    lastSettingsTabActivationId = activationId
    currentTab.value = settingsTab
  },
  { immediate: true }
)

const session = useSettingsSessionStore()
const {
  draft: userConfig,
  isSaving,
  saveError,
  conflicts,
  isConfigNewer: configIsNewer,
} = storeToRefs(session)
const conflictTitles = computed(() =>
  settingsTitlesOfConfigPaths(conflicts.value, t)
)
const isReloading = ref(false)
async function reloadSettings() {
  isReloading.value = true
  try {
    await session.reload()
  } catch (error) {
    toastError(error, 'toast.settingsSaveFailed')
  } finally {
    isReloading.value = false
  }
}
function resolveConflicts(keep: 'mine' | 'theirs') {
  session.resolveConflicts(keep)
  void session.persist()
}

const installedPlugins = computed(() =>
  resolveInstalledPlugins(
    pluginFactories,
    userConfig.value,
    pluginRuntimeStates
  )
)

const currentPlugin = computed(() => {
  const tab = current.value
  return tab.kind === 'plugin'
    ? installedPlugins.value.find((plugin) => plugin.pluginId === tab.pluginId)
    : undefined
})

const navigationSources = computed(() => ({
  translate: t,
  isInDevelopment: userConfig.value.isInDevelopment,
  profiles: aiProfilesStore.profiles,
  projects: aiProfilesStore.projects,
  plugins: installedPlugins.value.map((plugin) => ({
    pluginId: plugin.pluginId,
    label: plugin.labelKey
      ? t(plugin.labelKey)
      : plugin.label || plugin.pluginId,
    isEnabled: plugin.isEnabled,
  })),
}))

const navigation = computed(() =>
  buildSettingsNavigation(navigationSources.value)
)
const currentNavigationItemId = computed(() =>
  settingsNavigationItemId(currentTab.value)
)

const isAvailable = (tab: string) =>
  isSettingsTabAvailable(tab, {
    ...navigationSources.value,
    isVaultLoaded: aiProfilesStore.isLoaded,
  })

watch(
  () => route?.query.tab,
  (tab) => {
    currentTab.value =
      typeof tab === 'string' && isAvailable(tab) ? tab : DEFAULT_SETTINGS_TAB
  }
)
watch(
  [currentTab, navigationSources, () => aiProfilesStore.isLoaded],
  ([tab]) => {
    if (!isAvailable(tab)) currentTab.value = DEFAULT_SETTINGS_TAB
  },
  { immediate: true }
)

const currentTabTitle = computed(() =>
  settingsTabTitle(currentTab.value, navigationSources.value)
)
const showPageTitle = computed(() => hasSettingsPageTitle(currentTab.value))

const effectiveAppLanguage = computed(() =>
  resolveUiLanguagePreference(
    userConfig.value.language.ui,
    getNavigatorLanguages()
  )
)

const operations = createSettingsOperations({
  getConfig: () => userConfig.value,
  pluginFactories: () => pluginFactories,
  persist: session.persist,
  isSaved: session.isSaved,
  hasSecret: (id) => Object.hasOwn(secretsStore.secrets, id),
  removeSecret: (id) => secretsStore.removeSecret(id),
  notifySecretError: (error) => toastError(error, 'settings.keySaveFailed'),
})

/** The command the commands tab opens with */
const focusCommandId = ref<string>()

/** The variable the variables tab opens with */
const focusVariableId = ref<string>()

watch(currentTab, (tab) => {
  if (tab !== 'commands') focusCommandId.value = undefined
  if (tab !== 'variables') focusVariableId.value = undefined
})

provide(SETTINGS_CONTEXT_KEY, {
  draft: userConfig,
  operations,
  effectiveAppLanguage,
  navigate: (tab) => {
    const [targetTab, hash] = tab.split('#')
    currentTab.value = targetTab
    if (hash) {
      void nextTick(() => {
        const el = document.getElementById(hash)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  },
  editCommand: (commandId) => {
    focusCommandId.value = commandId
    currentTab.value = 'commands'
  },
  editVariable: (variableId) => {
    focusVariableId.value = variableId
    currentTab.value = 'variables'
  },
  variables: () =>
    deviceVariableValues(userConfig.value, desktopStore.userData),
})

// the address keeps the open tab, e.g. for going back to it
watch(currentTab, (tab) => {
  void appNavigation.rememberConfigTab(tab)
})

onMounted(() => {
  void Promise.resolve(secretsStore.refreshSecrets()).catch((error: unknown) =>
    toastError(error, 'settings.keySaveFailed')
  )
})
onUnmounted(() => {
  void session.persist()
})
</script>

<style scoped>
.settings-panel {
  container-type: inline-size;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.settings-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.settings-fields:disabled {
  pointer-events: none;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 236px;
  flex-shrink: 0;
  padding: var(--space-lg) var(--space-md);
  border-right: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-nav-title {
  padding: 0 var(--space-sm) var(--space-xs);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.settings-nav-category {
  padding: var(--space-md) var(--space-sm) var(--space-xs);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-content-inner {
  container-type: inline-size;
  max-width: 820px;
  padding: var(--space-xl) var(--space-2xl) var(--space-3xl);
}

.settings-page-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xl);
  font-size: var(--text-heading);
  font-weight: 600;
}

@media (max-width: 45rem) {
  .settings-nav {
    width: 64px;
    padding-inline: var(--space-sm);
  }

  .settings-nav-title,
  .settings-nav-category {
    display: none;
  }
}
</style>
