<template>
  <div class="settings-panel">
    <aside class="settings-nav">
      <div class="settings-nav-title">{{ t('nav.settings') }}</div>
      <Tabs :tabs="primaryTabs" v-model:value="currentTab" variant="vertical" />
      <div v-if="installedPlugins.length > 0" class="settings-subnav">
        <button
          v-for="plugin in installedPlugins"
          :key="plugin.name"
          type="button"
          class="settings-subnav-item"
          :class="{ 'is-active': currentTab === `plugin:${plugin.name}` }"
          :title="
            plugin.labelKey ? t(plugin.labelKey) : plugin.label || plugin.name
          "
          @click="currentTab = `plugin:${plugin.name}`"
        >
          <Icon icon="mdi:puzzle-outline" height="14" class="shrink-0" />
          <span class="truncate">
            {{
              plugin.labelKey ? t(plugin.labelKey) : plugin.label || plugin.name
            }}
          </span>
          <span
            class="settings-subnav-status"
            :class="plugin.enabled ? 'is-enabled' : 'is-disabled'"
          >
            {{
              plugin.enabled
                ? t('settings.pluginStatusOn')
                : t('settings.pluginStatusOff')
            }}
          </span>
        </button>
      </div>
      <div class="settings-nav-category">
        {{ t('settings.actionsCategory') }}
      </div>
      <Tabs :tabs="actionTabs" v-model:value="currentTab" variant="vertical" />
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <h1 v-if="currentTab !== 'global-actions'" class="settings-page-title">
          <span>{{ currentTabTitle }}</span>
        </h1>

        <p v-if="configIsNewer" class="settings-config-warning" role="alert">
          <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
          <span>{{ t('settings.configNewerWarning') }}</span>
        </p>

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

        <template v-else-if="currentTab === 'accessibility'">
          <SettingsSection :title="t('settings.sectionAccessibility')">
            <FieldRow
              :label="t('settings.contrast')"
              :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
            >
              <FieldSelect
                v-model:value="userConfig.contrast"
                :disabled="isEInkTheme"
                :options="contrastOptions"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.motion')"
              :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
            >
              <FieldSelect
                v-model:value="userConfig.motion"
                :disabled="isEInkTheme"
                :options="motionOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.uiScale')">
              <FieldSelect
                :value="userConfig.uiScale"
                :options="uiScaleOptions"
                @update:value="updateUiScale"
              />
            </FieldRow>
          </SettingsSection>
        </template>

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
          @update:to-translate-languages="updateTranslateLanguages"
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
          @update:launcher-commands="userConfig.launcherCommands = $event"
          @update:launcher-pages="updateLauncherPages"
          @update:launcher-pages-without-text="
            userConfig.launcherPagesWithoutText = $event
          "
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
          v-model:image-quality="userConfig.chatImageQuality"
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
          :plugin="currentPlugin"
          @back="currentTab = 'plugins'"
          @update:plugin-config="updatePluginConfig"
          @update:plugin-enabled="updatePluginEnabled"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import {
  createCommand,
  normalizeCommands,
  normalizeLauncherCommands,
} from '../lib/commands/command-config'
import { syncI18nLocale } from '../lib/i18n'
import {
  AUTO_LANGUAGE_VALUE,
  getNavigatorLanguages,
  normalizeLocale,
  resolveUiLanguagePreference,
} from '../lib/locale/language'
import { applyPluginPreset } from '../lib/plugins/plugin-config'
import { resolveInstalledPlugins } from '../lib/plugins/plugin-settings'
import { createSettingsConfig } from '../lib/settings/settings-config'
import { createSettingsSession } from '../lib/settings/settings-session'
import { pluginIndexes, pluginRuntimeStates } from '../plugins'
import { useActionMenuStore } from '../stores/action-menu'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { useThemeStore } from '../stores/theme'
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
import SettingsTasksTab from './settings/SettingsTasksTab.vue'
import SettingsTranslationsTab from './settings/SettingsTranslationsTab.vue'
import SettingsVoiceTab from './settings/SettingsVoiceTab.vue'
import { Icon } from '@iconify/vue'
import type { UserConfig } from '@tyco/shared'
import {
  type BuiltinToolId,
  CONFIG_VERSION,
  type CommandConfig,
  type ContrastMode,
  type MainActionConfig,
  type MotionMode,
  SELECTION_HOTKEY_PREFIX,
  UI_SCALES,
  isUiScale,
} from '@tyco/shared'

const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const themeStore = useThemeStore()
const { t } = useI18n()
const { toastText } = useToast()

const SAVE_DEBOUNCE_MS = 500

const route = useRoute()
// another page may open the settings on a tab of its own
const requestedTab = route?.query.tab
const currentTab = ref(
  typeof requestedTab === 'string' && requestedTab ? requestedTab : 'general'
)

const { prepare: createPreparedUserConfig } = createSettingsConfig({
  resolveMainActions: actionMenuStore.resolveMainActions,
  getRegisteredActions: actionMenuStore.getRegisteredActions,
  pluginIndexes: () => pluginIndexes,
  appearance: () => themeStore.settings,
})
const session = createSettingsSession({
  initialConfig: ipcStore.params.userConfig,
  prepare: createPreparedUserConfig,
  save: (next, base) => ipcStore.saveUserConfig(next, base),
  canSave: () => !configIsNewer.value,
  // the detail comes from the backend as it is: the summary is the user's
  notifyError: (error) =>
    toastText(
      error
        ? `${t('toast.settingsSaveFailed')}: ${error}`
        : t('toast.settingsSaveFailed'),
      'error'
    ),
  debounceMs: SAVE_DEBOUNCE_MS,
})
const userConfig = session.draft

const primaryTabs = computed(() => [
  { text: t('settings.generalTab'), key: 'general', icon: 'mdi:tune-variant' },
  { text: t('settings.editorTab'), key: 'editor', icon: 'mdi:pencil-outline' },
  { text: t('settings.historyTab'), key: 'history', icon: 'mdi:history' },
  {
    text: t('settings.hotkeysTab'),
    key: 'global-actions',
    icon: 'mdi:keyboard-outline',
  },
  { text: t('settings.sttTab'), key: 'stt', icon: 'mdi:microphone-outline' },
  { text: t('settings.llmTab'), key: 'llm', icon: 'mdi:cube-outline' },
  {
    text: t('settings.translationsTab'),

    key: 'translations',
    icon: 'mdi:translate',
  },
  {
    text: t('settings.sectionAccessibility'),
    key: 'accessibility',
    icon: 'mdi:human-handsup',
  },
  {
    text: t('settings.pluginsTab'),
    key: 'plugins',
    icon: 'mdi:puzzle-outline',
  },
])

const installedPlugins = computed(() =>
  resolveInstalledPlugins(pluginIndexes, userConfig.value, pluginRuntimeStates)
)

const currentPluginName = computed(() =>
  currentTab.value.startsWith('plugin:')
    ? currentTab.value.slice('plugin:'.length)
    : null
)

const currentPlugin = computed(() =>
  currentPluginName.value
    ? installedPlugins.value.find((p) => p.name === currentPluginName.value) ||
      null
    : null
)

const actionTabs = computed(() => [
  {
    text: t('settings.mainActionsTab'),
    key: 'main-actions',
    icon: 'mdi:gesture-tap-button',
  },
  { text: t('settings.tasksTab'), key: 'tasks', icon: 'mdi:robot-outline' },
  { text: t('settings.languagesTab'), key: 'languages', icon: 'mdi:web' },
  {
    text: t('settings.launcherCommandsTab'),
    key: 'launcher-commands',
    icon: 'mdi:console',
  },
  {
    text: t('settings.commandsTab'),
    key: 'commands',
    icon: 'mdi:console-line',
  },
])

const currentTabTitle = computed(() => {
  if (currentPlugin.value) {
    return (
      (currentPlugin.value.labelKey
        ? t(currentPlugin.value.labelKey)
        : currentPlugin.value.label || currentPlugin.value.name) || ''
    )
  }
  return (
    [...primaryTabs.value, ...actionTabs.value].find(
      (tab) => tab.key === currentTab.value
    )?.text || ''
  )
})

const contrastOptions = computed<{ id: ContrastMode; name: string }[]>(() => [
  { id: 'auto', name: t('settings.contrastAuto') },
  { id: 'normal', name: t('settings.contrastNormal') },
  { id: 'more', name: t('settings.contrastMore') },
])

const motionOptions = computed<{ id: MotionMode; name: string }[]>(() => [
  { id: 'auto', name: t('settings.motionAuto') },
  { id: 'normal', name: t('settings.motionNormal') },
  { id: 'reduce', name: t('settings.motionReduce') },
])

const uiScaleOptions = UI_SCALES.map((scale) => ({
  id: scale,
  name: `${scale}%`,
}))

const isEInkTheme = computed(() => userConfig.value.theme === 'e-ink')

watch(() => ipcStore.params.userConfig, session.applyIncoming)
watch(userConfig, session.schedule, { deep: true })

const navigatorLanguages = computed(() => getNavigatorLanguages())

const effectiveAppLanguage = computed(() =>
  resolveUiLanguagePreference(
    userConfig.value.appLanguage,
    userConfig.value.userLanguage,
    navigatorLanguages.value
  )
)

const persistUserConfig = session.persist

async function finishProviderRemoval(id: string) {
  await persistUserConfig()
  if (!session.isSaved()) {
    return
  }
  if (Object.hasOwn(llmStore.secrets, id)) {
    try {
      await llmStore.removeSecret(id)
    } catch (error) {
      toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
    }
  }
}

watch(
  () => [userConfig.value.appLanguage, userConfig.value.userLanguage],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  }
)

const updateTranslateLanguages = (languages: string[]) => {
  userConfig.value.toTranslateLanguages = languages
}

const updateMainActions = (actions: (MainActionConfig | null)[]) => {
  userConfig.value.mainActions = actions
}

const updateLauncherPages = (pages: (string | null)[][]) => {
  const previous = userConfig.value.launcherPages ?? []
  if (pages.length < previous.length) {
    const removed =
      previous.findIndex((page: (string | null)[]) => !pages.includes(page)) + 1
    userConfig.value.mainActions = userConfig.value.mainActions.map(
      (item: MainActionConfig | null) => {
        if (item?.type !== 'launcherPage' || item.page < removed) return item
        return item.page === removed ? null : { ...item, page: item.page - 1 }
      }
    )
    userConfig.value.launcherPagesWithoutText = (
      userConfig.value.launcherPagesWithoutText ?? []
    )
      .filter((page: number) => page !== removed)
      .map((page: number) => (page > removed ? page - 1 : page))
  }
  userConfig.value.launcherPages = pages
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
  const command = createCommand(toolId)
  const nextCommands = [
    ...normalizeCommands(userConfig.value.commands),
    command,
  ]
  const slots = normalizeLauncherCommands(
    page
      ? userConfig.value.launcherPages?.[page - 1]
      : userConfig.value.launcherCommands,
    nextCommands
  )
  slots[index] = command.id
  userConfig.value.commands = nextCommands
  if (page) {
    const pages = [...(userConfig.value.launcherPages ?? [])]
    pages[page - 1] = slots
    userConfig.value.launcherPages = pages
  } else userConfig.value.launcherCommands = slots
  editCommand(command.id)
}

/** A newer build wrote the config: it is shown but never written over */
const configIsNewer = computed(
  () => (userConfig.value.configVersion ?? 0) > CONFIG_VERSION
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

// <select> reports option values as strings
const updateUiScale = (value: string | number | undefined) => {
  const scale = Number(value)

  if (isUiScale(scale)) {
    userConfig.value.uiScale = scale
  }
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

const updatePluginEnabled = (pluginName: string, enabled: boolean) => {
  const current = userConfig.value.plugins[pluginName]
  userConfig.value.plugins[pluginName] = {
    ...(current && typeof current === 'object' ? current : {}),
    enabled,
  }
}

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, unknown>
) => {
  const current = userConfig.value.plugins[pluginName]
  const previous: Record<string, unknown> =
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)
      : {}
  const definition = pluginIndexes.find(
    (factory) => factory().id === pluginName
  )?.()
  userConfig.value.plugins[pluginName] = definition
    ? applyPluginPreset(definition, previous, values)
    : { ...previous, ...values }
}
onMounted(() => {
  void llmStore.refreshSecrets()
})
onUnmounted(() => {
  session.dispose()
})
</script>

<style scoped>
.settings-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
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
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.settings-nav-category {
  padding: var(--space-md) var(--space-sm) var(--space-xs);
  font-size: 0.6875rem;
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
  max-width: 820px;
  padding: var(--space-xl) var(--space-2xl) var(--space-3xl);
}

.settings-page-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xl);
  font-size: 1.25rem;
  font-weight: 600;
}

.settings-config-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xl);
  font-size: 0.875rem;
  color: var(--color-warning);
}

.settings-subnav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: -2px;
  margin-left: var(--space-md);
  padding-left: var(--space-xs);
  border-left: 1px solid var(--app-border-subtle);
}

.settings-subnav-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25;
  color: var(--app-text-muted);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  background: transparent;
  border: none;
  text-align: left;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.settings-subnav-item:hover {
  background-color: var(--app-hover);
  color: var(--color-base-content);
}

.settings-subnav-item.is-active {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.settings-subnav-status {
  margin-left: auto;
  padding: 0.0625rem 0.3125rem;
  border-radius: var(--radius-sm);
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.settings-subnav-status.is-enabled {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.settings-subnav-status.is-disabled {
  background-color: var(--app-hover);
  color: var(--app-text-faint);
}

@media (max-width: 720px) {
  .settings-nav {
    width: 64px;
    padding-inline: var(--space-sm);
  }

  .settings-nav-title,
  .settings-nav-category,
  .settings-nav :deep(.app-tab .truncate),
  .settings-subnav-item .truncate,
  .settings-subnav-status {
    display: none;
  }

  .settings-subnav {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }

  .settings-nav :deep(.app-tab),
  .settings-subnav-item {
    justify-content: center;
  }
}
</style>
