<template>
  <div class="settings-panel">
    <aside class="settings-nav">
      <div class="settings-nav-title">{{ t('nav.settings') }}</div>
      <NavigationList
        :label="t('nav.settings')"
        :items="primaryNavigationItems"
        v-model="currentTab"
      />
      <div class="settings-nav-category">
        {{ t('settings.actionsCategory') }}
      </div>
      <NavigationList
        :label="t('settings.actionsCategory')"
        :items="actionTabs"
        v-model="currentTab"
      />
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <h1 v-if="currentTab !== 'global-actions'" class="settings-page-title">
          <span>{{ currentTabTitle }}</span>
        </h1>

        <SettingsSaveStatus
          :config-is-newer="configIsNewer"
          :is-saving="isSaving"
          :is-reloading="isReloading"
          :save-error="saveError"
          :conflicts="conflicts"
          :has-unsaved-changes="hasUnsavedChanges"
          @reload="reloadSettings"
          @keep-local="keepLocalChanges"
          @retry="session.persist()"
        />

        <fieldset
          :key="`${session.reloadCount}:${configIsNewer}`"
          class="settings-fields"
          :disabled="configIsNewer || isReloading"
          :inert="configIsNewer || isReloading"
        >
          <SettingsGeneralTab
            v-if="currentTab === 'general'"
            :user-config="userConfig"
          />

          <SettingsEditorTab
            v-else-if="currentTab === 'editor'"
            :user-config="userConfig"
          />

          <SettingsHistoryTab
            v-else-if="currentTab === 'history'"
            :user-config="userConfig"
            :effective-app-language="effectiveAppLanguage"
          />

          <SettingsAccessibilityTab
            v-else-if="currentTab === 'accessibility'"
            v-model:appearance="userConfig.appearance"
          />

          <SettingsGlobalActionsTab
            v-else-if="currentTab === 'global-actions'"
            :user-config="userConfig"
            @update:hotkey="updateHotkey"
            @update:submit-key="userConfig.submitKey = $event"
          />
          <SettingsTranslationsTab
            v-else-if="currentTab === 'translations'"
            :user-config="userConfig"
            @navigate="currentTab = $event"
          />

          <SettingsLanguagesTab
            v-else-if="currentTab === 'languages'"
            :user-config="userConfig"
            @update:target-languages="updateTranslateLanguages"
            @navigate="currentTab = $event"
          />

          <SettingsMainActionsTab
            v-else-if="currentTab === 'main-actions'"
            :user-config="userConfig"
            @update:main-actions="updateMainActions"
            @edit-command="editCommand"
          />

          <SettingsLauncherTab
            v-else-if="currentTab === 'launcher-commands'"
            :user-config="userConfig"
            @update:launcher-pages="updateLauncherPages"
            @create-command="createLauncherCommand"
            @edit-command="editCommand"
          />

          <SettingsCommandsTab
            v-else-if="currentTab === 'commands'"
            :key="focusCommandId"
            :user-config="userConfig"
            :focus-command-id="focusCommandId"
            @update:external-access="userConfig.externalAccess = $event"
            @update:commands="updateCommands"
            @update:main-actions="updateMainActions"
            @navigate="currentTab = $event"
          />

          <SettingsVoiceTab
            v-else-if="currentTab === 'stt'"
            :user-config="userConfig"
          />

          <SettingsLlmTab
            v-else-if="currentTab === 'llm'"
            :llm="userConfig.llm"
            :ai-rules="userConfig.aiRules"
            v-model:image-quality="userConfig.chat.imageQuality"
            @provider-removed="finishProviderRemoval"
          />

          <SettingsTasksTab
            v-else-if="currentTab === 'tasks'"
            :user-config="userConfig"
            @update:ai-tasks="updateAiTasks"
          />

          <SettingsPluginsTab
            v-else-if="currentTab === 'plugins'"
            :user-config="userConfig"
            @select-plugin="currentTab = `plugin:${$event}`"
            @update:plugin-enabled="updatePluginEnabled"
          />

          <SettingsPluginDetailTab
            v-else-if="currentPlugin"
            :key="currentPlugin.pluginId"
            :plugin="currentPlugin"
            @back="currentTab = 'plugins'"
            @update:plugin-config="updatePluginConfig"
            @update:plugin-enabled="updatePluginEnabled"
          />

          <SettingsAiProfilesTab
            v-else-if="
              currentTab === 'ai-profiles' ||
              currentTab === 'ai-profiles:overview'
            "
            :user-config="userConfig"
            @update:vault-path="updateVaultPath"
            @navigate="currentTab = $event"
          />

          <SettingsProfileDetailTab
            v-else-if="currentTab.startsWith('ai-profile:')"
            :key="currentTab"
            :profile-id="currentTab.slice('ai-profile:'.length)"
            @back="currentTab = 'ai-profiles:overview'"
            @saved="currentTab = `ai-profile:${$event}`"
          />

          <SettingsProjectDetailTab
            v-else-if="currentTab.startsWith('ai-project:')"
            :key="currentTab"
            :project-id="currentTab.slice('ai-project:'.length)"
            @back="currentTab = 'ai-profiles:overview'"
            @saved="currentTab = `ai-project:${$event}`"
          />
        </fieldset>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import { createCommand } from '../lib/commands/command-config'
import { syncI18nLocale } from '../lib/i18n'
import {
  AUTO_LANGUAGE_VALUE,
  getNavigatorLanguages,
  normalizeLocale,
  resolveUiLanguagePreference,
} from '../lib/locale/language'
import { resolveInstalledPlugins } from '../lib/plugins/plugin-settings'
import { createSettingsOperations } from '../lib/settings/settings-operations'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { useLlmStore } from '../stores/llm'
import { usePluginRuntimeStore } from '../stores/plugin-runtime'
import { useSettingsSessionStore } from '../stores/settings-session'
import NavigationList from './common/NavigationList.vue'
import SettingsAccessibilityTab from './settings/SettingsAccessibilityTab.vue'
import SettingsAiProfilesTab from './settings/SettingsAiProfilesTab.vue'
import SettingsCommandsTab from './settings/SettingsCommandsTab.vue'
import SettingsEditorTab from './settings/SettingsEditorTab.vue'
import SettingsGeneralTab from './settings/SettingsGeneralTab.vue'
import SettingsGlobalActionsTab from './settings/SettingsGlobalActionsTab.vue'
import SettingsHistoryTab from './settings/SettingsHistoryTab.vue'
import SettingsLanguagesTab from './settings/SettingsLanguagesTab.vue'
import SettingsLauncherTab from './settings/SettingsLauncherTab.vue'
import SettingsLlmTab from './settings/SettingsLlmTab.vue'
import SettingsMainActionsTab from './settings/SettingsMainActionsTab.vue'
import SettingsPluginDetailTab from './settings/SettingsPluginDetailTab.vue'
import SettingsPluginsTab from './settings/SettingsPluginsTab.vue'
import SettingsProfileDetailTab from './settings/SettingsProfileDetailTab.vue'
import SettingsProjectDetailTab from './settings/SettingsProjectDetailTab.vue'
import SettingsSaveStatus from './settings/SettingsSaveStatus.vue'
import SettingsTasksTab from './settings/SettingsTasksTab.vue'
import SettingsTranslationsTab from './settings/SettingsTranslationsTab.vue'
import SettingsVoiceTab from './settings/SettingsVoiceTab.vue'
import type { UserConfig } from '@tyco/shared'
import {
  type BuiltinToolId,
  CONFIG_VERSION,
  type CommandConfig,
  type MainActionConfig,
  SELECTION_HOTKEY_PREFIX,
} from '@tyco/shared'

const { pluginFactories, pluginRuntimeStates } = usePluginRuntimeStore()
const llmStore = useLlmStore()
const aiProfilesStore = useAiProfilesStore()
const { t } = useI18n()
const { toastText } = useToast()

onMounted(() => {
  void aiProfilesStore.loadAll()
})

const route = useRoute()
// another page may open the settings on a tab of its own
const requestedTab = route?.query.tab
const currentTab = ref(
  typeof requestedTab === 'string' && requestedTab ? requestedTab : 'general'
)

const session = useSettingsSessionStore()
const {
  draft: userConfig,
  isSaving,
  saveError,
  conflicts,
  hasUnsavedChanges,
} = storeToRefs(session)
const isReloading = ref(false)
async function reloadSettings() {
  isReloading.value = true
  try {
    await session.reload()
  } catch (error) {
    toastText(`${t('toast.settingsSaveFailed')}: ${String(error)}`, 'error')
  } finally {
    isReloading.value = false
  }
}
function keepLocalChanges() {
  session.resolveConflicts(true)
  void session.persist()
}

const primaryTabs = computed(() => [
  { name: t('settings.generalTab'), id: 'general', icon: 'mdi:tune-variant' },
  { name: t('settings.editorTab'), id: 'editor', icon: 'mdi:pencil-outline' },
  { name: t('settings.historyTab'), id: 'history', icon: 'mdi:history' },
  {
    name: t('settings.hotkeysTab'),
    id: 'global-actions',
    icon: 'mdi:keyboard-outline',
  },
  { name: t('settings.sttTab'), id: 'stt', icon: 'mdi:microphone-outline' },
  { name: t('settings.llmTab'), id: 'llm', icon: 'mdi:cube-outline' },
  {
    name: t('settings.translationsTab'),

    id: 'translations',
    icon: 'mdi:translate',
  },
  {
    name: t('settings.sectionAccessibility'),
    id: 'accessibility',
    icon: 'mdi:human-handsup',
  },
  { name: t('settings.pluginsTab'), id: 'plugins', icon: 'mdi:puzzle-outline' },
  {
    name: t('settings.aiProfilesTab'),
    id: 'ai-profiles',
    icon: 'mdi:account-group-outline',
  },
])

const installedPlugins = computed(() =>
  resolveInstalledPlugins(
    pluginFactories,
    userConfig.value,
    pluginRuntimeStates
  )
)

const currentPluginId = computed(() =>
  currentTab.value.startsWith('plugin:')
    ? currentTab.value.slice('plugin:'.length)
    : null
)

const currentPlugin = computed(() =>
  currentPluginId.value
    ? installedPlugins.value.find(
        (p) => p.pluginId === currentPluginId.value
      ) || null
    : null
)

const primaryNavigationItems = computed(() =>
  primaryTabs.value.flatMap((item) => {
    if (item.id === 'ai-profiles') {
      const isExpanded =
        currentTab.value === 'ai-profiles' ||
        currentTab.value.startsWith('ai-profile') ||
        currentTab.value.startsWith('ai-project')
      if (!isExpanded) {
        return [item]
      }
      return [
        item,
        {
          id: 'ai-profiles:overview',
          name: t('settings.aiProfilesOverview'),
          icon: 'mdi:folder-outline',
          nested: true,
        },
        ...aiProfilesStore.profiles.map((p) => ({
          id: `ai-profile:${p.id}`,
          name: p.name,
          icon: 'mdi:account-outline',
          nested: true,
        })),
        {
          id: 'ai-profile:new',
          name: `+ ${t('settings.newProfile')}`,
          icon: 'mdi:plus',
          nested: true,
        },
        ...aiProfilesStore.projects.map((proj) => ({
          id: `ai-project:${proj.id}`,
          name: proj.name,
          icon: proj.isExternal
            ? 'mdi:folder-open-outline'
            : 'mdi:folder-table-outline',
          nested: true,
        })),
        {
          id: 'ai-project:new',
          name: `+ ${t('settings.newProject')}`,
          icon: 'mdi:plus',
          nested: true,
        },
      ]
    }
    if (item.id === 'plugins') {
      return [
        item,
        ...installedPlugins.value.map((plugin) => ({
          id: `plugin:${plugin.pluginId}`,
          name: plugin.labelKey
            ? t(plugin.labelKey)
            : plugin.label || plugin.pluginId,
          icon: 'mdi:puzzle-outline',
          nested: true,
          status: t(
            plugin.isEnabled
              ? 'settings.pluginStatusOn'
              : 'settings.pluginStatusOff'
          ),
          isEnabled: plugin.isEnabled,
        })),
      ]
    }
    return [item]
  })
)

const actionTabs = computed(() => [
  {
    name: t('settings.mainActionsTab'),
    id: 'main-actions',
    icon: 'mdi:gesture-tap-button',
  },
  { name: t('settings.tasksTab'), id: 'tasks', icon: 'mdi:robot-outline' },
  { name: t('settings.languagesTab'), id: 'languages', icon: 'mdi:web' },
  {
    name: t('settings.launcherCommandsTab'),
    id: 'launcher-commands',
    icon: 'mdi:console',
  },
  { name: t('settings.commandsTab'), id: 'commands', icon: 'mdi:console-line' },
])

const availableTabs = computed(
  () =>
    new Set([
      ...primaryTabs.value.map((tab) => tab.id),
      ...actionTabs.value.map((tab) => tab.id),
      ...installedPlugins.value.map((plugin) => `plugin:${plugin.pluginId}`),
      'ai-profiles:overview',
      'ai-profile:new',
      ...aiProfilesStore.profiles.map((p) => `ai-profile:${p.id}`),
      'ai-project:new',
      ...aiProfilesStore.projects.map((p) => `ai-project:${p.id}`),
    ])
)
/** A profile tab opened before the vault is read is not known yet */
const isPendingVaultTab = (tab: string) =>
  !aiProfilesStore.isLoaded && tab.startsWith('ai-profile:')
watch(
  () => route?.query.tab,
  (tab) => {
    currentTab.value =
      typeof tab === 'string' &&
      (availableTabs.value.has(tab) || isPendingVaultTab(tab))
        ? tab
        : 'general'
  }
)
watch(
  [currentTab, availableTabs, () => aiProfilesStore.isLoaded],
  ([tab, available]) => {
    if (!available.has(tab) && !isPendingVaultTab(tab))
      currentTab.value = 'general'
  },
  { immediate: true }
)

const currentTabTitle = computed(() => {
  if (currentPlugin.value) {
    return (
      (currentPlugin.value.labelKey
        ? t(currentPlugin.value.labelKey)
        : currentPlugin.value.label || currentPlugin.value.pluginId) || ''
    )
  }
  if (currentTab.value.startsWith('ai-profile:')) {
    const id = currentTab.value.slice('ai-profile:'.length)
    if (id === 'new') return t('settings.newProfile')
    return aiProfilesStore.getProfile(id)?.name || t('settings.aiProfilesTab')
  }
  if (currentTab.value.startsWith('ai-project:')) {
    const id = currentTab.value.slice('ai-project:'.length)
    if (id === 'new') return t('settings.newProject')
    return (
      aiProfilesStore.getProject(id)?.name || t('settings.projectPermissions')
    )
  }
  if (
    currentTab.value === 'ai-profiles' ||
    currentTab.value === 'ai-profiles:overview'
  ) {
    return t('settings.aiProfilesTab')
  }
  return (
    [...primaryTabs.value, ...actionTabs.value].find(
      (tab) => tab.id === currentTab.value
    )?.name || ''
  )
})

const navigatorLanguages = computed(() => getNavigatorLanguages())

const effectiveAppLanguage = computed(() =>
  resolveUiLanguagePreference(
    userConfig.value.appLanguage,
    userConfig.value.userLanguage,
    navigatorLanguages.value
  )
)

const persistUserConfig = session.persist

const operations = createSettingsOperations({
  getConfig: () => userConfig.value,
  pluginFactories: () => pluginFactories,
  createCommand,
  persist: persistUserConfig,
  isSaved: session.isSaved,
  hasSecret: (id) => Object.hasOwn(llmStore.secrets, id),
  removeSecret: (id) => llmStore.removeSecret(id),
  notifySecretError: (error) =>
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error'),
})
const {
  finishProviderRemoval,
  updateLauncherPages,
  updatePluginEnabled,
  updatePluginConfig,
} = operations
watch(
  () => [userConfig.value.appLanguage, userConfig.value.userLanguage],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  }
)

const updateTranslateLanguages = (languages: string[]) => {
  userConfig.value.translation.targetLanguages = languages
}

const updateMainActions = (actions: (MainActionConfig | null)[]) => {
  userConfig.value.mainActions = actions
}

const updateCommands = (commands: CommandConfig[]) => {
  userConfig.value.commands = commands
}

/** The command the commands tab opens with */
const focusCommandId = ref<string>()

watch(currentTab, (tab) => {
  if (tab !== 'commands') focusCommandId.value = undefined
})

const editCommand = (commandId: string) => {
  focusCommandId.value = commandId
  currentTab.value = 'commands'
}

const createLauncherCommand = (
  index: number,
  toolId: BuiltinToolId,
  page = 0
) => {
  editCommand(operations.createLauncherCommand(index, toolId, page))
}

/** A newer build wrote the config: it is shown but never written over */
const configIsNewer = computed(
  () =>
    Math.max(
      userConfig.value.configVersion ?? 0,
      session.latestConfig.configVersion ?? 0
    ) > CONFIG_VERSION
)

const updateHotkey = (mode: string, shortcut: string) => {
  if (mode.startsWith(SELECTION_HOTKEY_PREFIX)) {
    const action = mode.slice(SELECTION_HOTKEY_PREFIX.length)
    userConfig.value.selectionHotkeys = {
      ...userConfig.value.selectionHotkeys,
      [action]: shortcut,
    }
    return
  }
  userConfig.value.hotkeys[mode] = shortcut
}

watch(
  () => userConfig.value.userLanguage,
  (userLanguage) => {
    const normalized = normalizeLocale(userLanguage || AUTO_LANGUAGE_VALUE)
    if (userConfig.value.userLanguage !== normalized) {
      userConfig.value.userLanguage = normalized
    }
  }
)

const updateAiTasks = (items: UserConfig['aiTasks']) => {
  userConfig.value.aiTasks = items
}

const updateVaultPath = (vaultPath: string | undefined) => {
  if (vaultPath) {
    userConfig.value.aiProfiles = {
      ...(userConfig.value.aiProfiles || {}),
      vaultPath,
    }
  } else if (userConfig.value.aiProfiles) {
    delete userConfig.value.aiProfiles.vaultPath
  }
}

onMounted(() => {
  void Promise.resolve(llmStore.refreshSecrets()).catch((error: unknown) =>
    toastText(`${t('settings.keySaveFailed')}: ${String(error)}`, 'error')
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
  width: 216px;
  flex-shrink: 0;
  padding: var(--space-lg) var(--space-md);
  border-right: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
  overflow-y: auto;
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
