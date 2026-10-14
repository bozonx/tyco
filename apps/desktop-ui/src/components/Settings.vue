<template>
  <div class="settings-panel">
    <aside class="settings-nav">
      <div class="settings-nav-title">{{ t('nav.settings') }}</div>
      <Tabs
        kind="navigation"
        :label="t('nav.settings')"
        :tabs="primaryTabs"
        v-model:value="currentTab"
        variant="vertical"
      />
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
          :aria-label="
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
      <Tabs
        kind="navigation"
        :label="t('settings.actionsCategory')"
        :tabs="actionTabs"
        v-model:value="currentTab"
        variant="vertical"
      />
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <h1 v-if="currentTab !== 'global-actions'" class="settings-page-title">
          <span>{{ currentTabTitle }}</span>
        </h1>

        <p v-if="configIsNewer" class="settings-config-warning" role="alert">
          <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
          <span>{{ t('settings.configNewerWarning') }}</span>
          <Button
            size="sm"
            :disabled="isSaving || isReloading"
            @click="reloadSettings"
            >{{ t('settings.saveReload') }}</Button
          >
        </p>

        <div
          v-else
          class="settings-save-status"
          role="status"
          aria-live="polite"
        >
          <span>{{
            t(
              isSaving
                ? 'settings.saveSaving'
                : saveError || conflicts.length
                  ? 'settings.saveFailed'
                  : hasUnsavedChanges
                    ? 'settings.savePending'
                    : 'settings.saveSaved'
            )
          }}</span>
          <template v-if="conflicts.length">
            <p>
              {{ t('settings.saveConflict', { fields: conflicts.join(', ') }) }}
            </p>
            <Button size="sm" :disabled="isSaving" @click="keepLocalChanges">{{
              t('settings.saveKeepLocal')
            }}</Button>
            <Button size="sm" :disabled="isSaving" @click="reloadSettings">{{
              t('settings.saveReload')
            }}</Button>
          </template>
          <template v-else-if="saveError">
            <p>{{ saveError }}</p>
            <Button size="sm" :disabled="isSaving" @click="session.persist()">{{
              t('settings.saveRetry')
            }}</Button>
            <Button size="sm" :disabled="isSaving" @click="reloadSettings">{{
              t('settings.saveReload')
            }}</Button>
          </template>
        </div>

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
import { useLlmStore } from '../stores/llm'
import { usePluginRuntimeStore } from '../stores/plugin-runtime'
import { useSettingsSessionStore } from '../stores/settings-session'
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

const { pluginIndexes, pluginRuntimeStates } = usePluginRuntimeStore()
const llmStore = useLlmStore()
const { t } = useI18n()
const { toastText } = useToast()

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

const availableTabs = computed(
  () =>
    new Set([
      ...primaryTabs.value.map((tab) => tab.key),
      ...actionTabs.value.map((tab) => tab.key),
      ...installedPlugins.value.map((plugin) => `plugin:${plugin.name}`),
    ])
)
watch(
  () => route?.query.tab,
  (tab) => {
    currentTab.value =
      typeof tab === 'string' && availableTabs.value.has(tab) ? tab : 'general'
  }
)
watch(
  [currentTab, availableTabs],
  ([tab, available]) => {
    if (!available.has(tab)) currentTab.value = 'general'
  },
  { immediate: true }
)

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
  pluginIndexes: () => pluginIndexes,
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
  userConfig.value.toTranslateLanguages = languages
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
.settings-save-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
.settings-save-status p {
  flex-basis: 100%;
  overflow-wrap: anywhere;
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
  font-size: var(--text-body);
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
  font-size: var(--text-control);
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
