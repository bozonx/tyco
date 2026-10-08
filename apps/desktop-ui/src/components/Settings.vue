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
      <div class="settings-nav-footer">
        <Icon icon="mdi:cloud-check-outline" height="14" />
        <span>{{ t('settings.autosaveHint') }}</span>
      </div>
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

        <template v-if="currentTab === 'general'">
          <SettingsSection :title="t('settings.sectionAppearance')">
            <FieldRow :label="t('settings.theme')">
              <SegmentedControl
                v-model:value="userConfig.theme"
                :label="t('settings.theme')"
                :options="themeOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.userLanguage')">
              <FieldSelect
                v-model:value="userConfig.userLanguage"
                :options="userLanguageOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.appLanguage')">
              <div class="flex items-center gap-2 w-full">
                <FieldSelect
                  v-if="isAppLanguageManual"
                  class="flex-1"
                  :value="effectiveAppLanguage"
                  :options="appLanguageOptions"
                  @update:value="updateAppLanguage"
                />
                <span v-else class="flex-1 text-sm text-muted">
                  {{ getLanguageName(effectiveAppLanguage) }}
                </span>
                <Button sm ghost @click="toggleAppLanguageMode">
                  {{
                    isAppLanguageManual
                      ? t('settings.appLanguageAuto')
                      : t('settings.appLanguageManual')
                  }}
                </Button>
              </div>
            </FieldRow>
          </SettingsSection>

          <SettingsSection :title="t('settings.sectionHistory')">
            <div class="editor-history-group">
              <FieldRow
                :label="t('settings.editorHistoryStorage')"
                :info="t('settings.editorHistoryStorageHint')"
              >
                <FieldSelect
                  v-model:value="userConfig.editorHistoryStorage"
                  :options="editorHistoryStorageOptions"
                />
              </FieldRow>
              <div
                v-if="userConfig.editorHistoryStorage !== 'off'"
                class="editor-history-nested"
              >
                <FieldRow :label="t('settings.editorHistoryMaxItems')">
                  <FieldInput
                    type="number"
                    :value="userConfig.editorHistoryMaxItems"
                    @update:value="setEditorHistoryLimit"
                  />
                </FieldRow>
                <template v-if="userConfig.editorHistoryStorage === 'disk'">
                  <FieldRow
                    :label="t('settings.editorHistoryRetentionDays')"
                    :info="t('settings.editorHistoryRetentionDaysHint')"
                  >
                    <FieldSelect
                      :value="userConfig.editorHistoryRetentionDays ?? 0"
                      :options="editorHistoryRetentionOptions"
                      @update:value="setEditorHistoryRetentionDays"
                    />
                  </FieldRow>
                  <FieldRow
                    :label="t('settings.sanitizeSecretsInEditorHistory')"
                    :info="t('settings.sanitizeSecretsInEditorHistoryHint')"
                  >
                    <FieldCheckbox
                      v-model:value="userConfig.sanitizeSecretsInEditorHistory"
                    />
                  </FieldRow>
                </template>
              </div>
            </div>
            <FieldRow
              :label="t('settings.chatHistoryMaxItems')"
              :info="t('settings.chatHistoryPrivacyHint')"
            >
              <FieldInput
                type="number"
                :value="userConfig.chatHistoryMaxItems"
                @update:value="setHistoryLimit('chatHistoryMaxItems', $event)"
              />
            </FieldRow>
          </SettingsSection>

          <SettingsSection :title="t('settings.sectionWindowInsertion')">
            <FieldRow
              :label="t('settings.windowInsertion')"
              :info="t('settings.windowInsertionHint')"
            >
              <div class="flex flex-col gap-2 w-full">
                <Tabs
                  variant="segmented"
                  :tabs="windowInsertionTabs"
                  :value="userConfig.windowInsertion.method"
                  @update:value="updateWindowInsertionMethod"
                />
                <FieldInput
                  v-if="userConfig.windowInsertion.method === 'xdotool'"
                  v-model:value="userConfig.windowInsertion.xdotoolBin"
                />
                <FieldInput
                  v-if="userConfig.windowInsertion.method === 'ydotool'"
                  v-model:value="userConfig.windowInsertion.ydotoolBin"
                />
              </div>
            </FieldRow>
            <FieldRow
              :label="t('settings.pasteShortcut')"
              :info="t('settings.pasteShortcutHint')"
            >
              <FieldSelect
                v-model:value="userConfig.windowInsertion.pasteShortcut"
                :options="pasteShortcutOptions"
              />
            </FieldRow>
          </SettingsSection>

          <details class="storage-details">
            <summary class="storage-summary">
              {{ t('settings.storageLocations') }}
            </summary>
            <div v-if="!storageInfo" class="text-sm text-muted">
              {{ t('settings.storageLocationsUnavailable') }}
            </div>
            <div v-else class="storage-list">
              <div
                v-for="item in storageInfoItems"
                :key="item.key"
                class="storage-item"
              >
                <span class="storage-item-label">
                  {{ item.label }}
                  <span v-if="item.hint" class="storage-item-hint">{{
                    item.hint
                  }}</span>
                </span>
                <div class="storage-path-box">
                  <code class="storage-path" :title="item.value">{{
                    item.value
                  }}</code>
                  <div class="storage-path-actions">
                    <button
                      type="button"
                      class="storage-copy-btn"
                      :title="
                        copiedStorageKey === item.key
                          ? t('settings.storagePathCopied')
                          : t('settings.storageCopyPath')
                      "
                      :aria-label="t('settings.storageCopyPath')"
                      @click="copyStoragePath(item.value, item.key)"
                    >
                      <Icon
                        :icon="
                          copiedStorageKey === item.key
                            ? 'mdi:check'
                            : 'mdi:content-copy'
                        "
                        height="14"
                        class="shrink-0"
                      />
                    </button>
                    <button
                      type="button"
                      class="storage-copy-btn"
                      :title="t('settings.storageOpenFolder')"
                      :aria-label="t('settings.storageOpenFolder')"
                      @click="openStorageLocation(item.kind)"
                    >
                      <Icon
                        icon="mdi:folder-open-outline"
                        height="14"
                        class="shrink-0"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </template>

        <SettingsEditorTab
          v-else-if="currentTab === 'editor'"
          :user-config="userConfig"
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
          @create-command="createMenuCommand"
          @edit-command="editCommand"
        />

        <SettingsCommandsTab
          v-else-if="currentTab === 'commands'"
          :key="focusCommandId"
          :user-config="userConfig"
          :focus-command-id="focusCommandId"
          @update:commands="updateCommands"
          @update:main-actions="updateMainActions"
        />

        <div v-else-if="currentTab === 'stt'">
          <SettingsSection>
            <FieldRow :label="t('settings.sttProvider')">
              <FieldSelect
                :value="currentSttModel.provider"
                :options="sttProviderOptions"
                @update:value="setSttProvider"
              />
            </FieldRow>
            <FieldRow
              v-if="!sttNeedsKey"
              :label="t('settings.sttServerUrl')"
              :hint="t('settings.sttServerUrlHint')"
            >
              <FieldInput
                :value="currentSttModel.baseUrl || ''"
                placeholder="ws://localhost:6006"
                @update:value="setSttServerUrl"
              />
            </FieldRow>
            <FieldRow v-if="sttNeedsKey" :label="t('settings.model')">
              <FieldInput
                :value="currentSttModel.model || ''"
                placeholder="nova-3"
                @update:value="setSttModelName"
              />
            </FieldRow>
            <FieldRow
              v-if="sttNeedsKey"
              :label="t('settings.sttLanguage')"
              :hint="t('settings.sttLanguageHint')"
            >
              <FieldSelect
                :value="currentSttModel.language || DICTATION_LANGUAGE_USER"
                :options="sttLanguageOptions"
                @update:value="setSttLanguage"
              />
            </FieldRow>
            <FieldRow v-if="sttNeedsKey" :label="t('settings.apiKey')">
              <div class="flex items-center gap-2 w-full">
                <FieldInput
                  class="flex-1"
                  type="password"
                  :value="sttKeyDraft"
                  :placeholder="
                    hasSttKey
                      ? t('settings.apiKeyReplacePlaceholder')
                      : t('settings.apiKeyPlaceholder')
                  "
                  @update:value="sttKeyDraft = $event"
                />
                <Button sm :disabled="!sttKeyDraft.trim()" @click="saveSttKey">
                  {{ t('settings.saveKey') }}
                </Button>
                <Button v-if="hasSttKey" sm ghost @click="removeSttKey">
                  {{ t('settings.removeKey') }}
                </Button>
              </div>
            </FieldRow>
            <FieldRow :label="t('settings.formatWithLlm')">
              <FieldCheckbox
                :value="Boolean(currentSttModel.formatWithLlm)"
                @update:value="setSttFormatWithLlm"
              />
            </FieldRow>
            <FieldRow
              v-if="Boolean(currentSttModel.formatWithLlm)"
              :label="t('settings.sttLlmRules')"
              vertical
            >
              <FieldTextArea
                v-model:value="userConfig.aiRules.voiceCorrection"
              />
            </FieldRow>
          </SettingsSection>
        </div>

        <SettingsLlmTab
          v-else-if="currentTab === 'llm'"
          :llm="userConfig.llm"
          :ai-rules="userConfig.aiRules"
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

import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { normalizeMainActions } from '../lib/action-menu/main-actions'
import {
  createCommand,
  normalizeCommands,
} from '../lib/commands/command-config'
import {
  editorHistoryRetentionChoices,
  normalizeEditorConfig,
} from '../lib/history/editor-history-storage'
import { syncI18nLocale } from '../lib/i18n'
import { resolveSubmitKey } from '../lib/input-keys/input-keys'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import {
  AUTO_LANGUAGE_VALUE,
  SUPPORTED_UI_LANGUAGE_OPTIONS,
  buildLanguageOptions,
  getNavigatorLanguages,
  normalizeLocale,
  resolveUiLanguagePreference,
  toHtmlLang,
} from '../lib/locale/language'
import { resolveInstalledPlugins } from '../lib/plugins/plugin-settings'
import { normalizeShortcutSlots } from '../lib/shortcut-slots/shortcut-slots'
import {
  DICTATION_LANGUAGE_MULTI,
  DICTATION_LANGUAGE_USER,
} from '../lib/stt/dictation-language'
import { secretId, sttProviderNeedsKey } from '../lib/stt/stt-client'
import {
  activeSttModel,
  normalizeSttConfig,
  selectSttProvider,
} from '../lib/stt/stt-config'
import { normalizeTranslationConfig } from '../lib/translation/translation-config'
import { pluginIndexes, usePlugins } from '../plugins'
import { useActionMenuStore } from '../stores/actionMenu'
import { useIpcStore } from '../stores/ipc'
import { useLlmStore } from '../stores/llm'
import { useThemeStore } from '../stores/theme'
import SettingsCommandsTab from './settings/SettingsCommandsTab.vue'
import SettingsEditorTab from './settings/SettingsEditorTab.vue'
import SettingsGlobalActionsTab from './settings/SettingsGlobalActionsTab.vue'
import SettingsLanguagesTab from './settings/SettingsLanguagesTab.vue'
import SettingsLlmTab from './settings/SettingsLlmTab.vue'
import SettingsMainActionsTab from './settings/SettingsMainActionsTab.vue'
import SettingsPluginDetailTab from './settings/SettingsPluginDetailTab.vue'
import SettingsPluginsTab from './settings/SettingsPluginsTab.vue'
import SettingsTasksTab from './settings/SettingsTasksTab.vue'
import SettingsTranslationsTab from './settings/SettingsTranslationsTab.vue'
import { Icon } from '@iconify/vue'
import {
  normalizeMarkdownCleanSettings,
  normalizeMarkdownSettings,
} from '@tyco/shared'
import {
  type BuiltinToolId,
  CONFIG_VERSION,
  type CommandConfig,
  type ContrastMode,
  DEFAULT_USER_CONFIG,
  type MainActionConfig,
  type MotionMode,
  PASTE_SHORTCUTS,
  SELECTION_HOTKEY_PREFIX,
  type StorageInfo,
  type StorageKind,
  type SttProvider,
  type ThemeMode,
  UI_SCALES,
  isUiScale,
  normalizeAppearance,
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

const userConfig = ref(createPreparedUserConfig(ipcStore.params.userConfig))
const lastPersistedConfig = ref(serializeUserConfig(userConfig.value))
const storageInfo = ref<StorageInfo | null>(null)
const sttKeyDraft = ref('')
let isComponentActive = true
let skipNextAutosave = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveQueue: Promise<void> = Promise.resolve()

const primaryTabs = computed(() => [
  { text: t('settings.generalTab'), key: 'general', icon: 'mdi:tune-variant' },
  { text: t('settings.editorTab'), key: 'editor', icon: 'mdi:pencil-outline' },
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
  resolveInstalledPlugins(pluginIndexes, userConfig.value)
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
  {
    text: t('settings.commandsTab'),
    key: 'commands',
    icon: 'mdi:console-line',
  },
  { text: t('settings.tasksTab'), key: 'tasks', icon: 'mdi:robot-outline' },
  { text: t('settings.languagesTab'), key: 'languages', icon: 'mdi:web' },
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

const themeOptions = computed<{ id: ThemeMode; name: string; icon: string }[]>(
  () => [
    { id: 'auto', name: t('theme.auto'), icon: 'mdi:theme-light-dark' },
    { id: 'light', name: t('theme.light'), icon: 'mdi:white-balance-sunny' },
    { id: 'dark', name: t('theme.dark'), icon: 'mdi:weather-night' },
    { id: 'e-ink', name: t('theme.eInk'), icon: 'mdi:book-open-page-variant' },
  ]
)

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

const windowInsertionTabs = computed(() => [
  { text: 'xdotool', key: 'xdotool' },
  { text: 'ydotool', key: 'ydotool' },
])

watch(
  () => ipcStore.params.userConfig,
  (incomingConfig) => {
    const preparedConfig = createPreparedUserConfig(incomingConfig)
    const serializedConfig = serializeUserConfig(preparedConfig)

    if (serializedConfig === lastPersistedConfig.value) {
      return
    }

    skipNextAutosave = true
    userConfig.value = preparedConfig
    lastPersistedConfig.value = serializedConfig
  },
  { immediate: true }
)

watch(
  userConfig,
  () => {
    if (skipNextAutosave) {
      skipNextAutosave = false
      return
    }

    scheduleAutosave()
  },
  { deep: true }
)

const STORAGE_KIND_LABELS: Record<StorageKind, string> = {
  config: 'settings.storageConfig',
  data: 'settings.storageData',
  cache: 'settings.storageCache',
  logs: 'settings.storageLogs',
}

const copiedStorageKey = ref<string | null>(null)
let copyStorageTimeout: ReturnType<typeof setTimeout> | null = null

async function copyStoragePath(path: string, key: string) {
  try {
    await navigator.clipboard.writeText(path)
    copiedStorageKey.value = key
    if (copyStorageTimeout) {
      clearTimeout(copyStorageTimeout)
    }
    copyStorageTimeout = setTimeout(() => {
      copiedStorageKey.value = null
    }, 2000)
  } catch {
    // Clipboard access might be denied
  }
}

/** One row per root directory, named after everything it holds. */
const storageInfoItems = computed(() =>
  (storageInfo.value?.locations ?? []).map((location) => ({
    key: location.kinds.join('-'),
    kind: location.kinds[0],
    label: location.kinds
      .map((kind) => t(STORAGE_KIND_LABELS[kind]))
      .join(' · '),
    hint: location.kinds.includes('data')
      ? t('settings.storageDataHint')
      : undefined,
    value: location.path,
  }))
)

async function openStorageLocation(kind: StorageKind) {
  // a failure leaves nothing open, which tells enough
  await ipcStore.callFunction('openStorageLocation', [kind])
}

function cloneUserConfig(config: unknown) {
  return JSON.parse(JSON.stringify(config || DEFAULT_USER_CONFIG))
}

function createPreparedUserConfig(config: unknown) {
  const nextConfig = cloneUserConfig(config)

  ensurePluginDefaults(nextConfig)
  normalizeAppearanceConfig(nextConfig)
  normalizeLanguageConfig(nextConfig)
  nextConfig.mainActions = actionMenuStore.resolveMainActions(
    nextConfig.mainActions,
    nextConfig.mainActionRegistrations ?? []
  )
  nextConfig.commands = normalizeCommands(nextConfig.commands)
  nextConfig.mainActionRegistrations = [
    ...new Set([
      ...(nextConfig.mainActionRegistrations ?? []),
      ...actionMenuStore
        .getRegisteredActions()
        .flatMap((action) => (action.id ? [action.id] : [])),
    ]),
  ]
  normalizeWindowInsertionConfig(nextConfig)
  normalizeEditorConfig(nextConfig)
  nextConfig.markdown = normalizeMarkdownSettings(nextConfig.markdown)
  nextConfig.markdownClean = normalizeMarkdownCleanSettings(
    nextConfig.markdownClean
  )
  normalizeHotkeysConfig(nextConfig)
  Object.assign(nextConfig, normalizeSttConfig(nextConfig))
  normalizeLlmConfigSection(nextConfig)
  nextConfig.translation = normalizeTranslationConfig(nextConfig.translation)
  delete nextConfig.chatRoles
  normalizeAiTasks(nextConfig)
  nextConfig.aiRules = {
    ...DEFAULT_USER_CONFIG.aiRules,
    ...(nextConfig.aiRules || {}),
  }
  // the common rule was replaced by per-task rules
  delete nextConfig.aiRules.base

  return nextConfig
}

function normalizeHotkeysConfig(config: Record<string, any>) {
  config.hotkeys = { ...DEFAULT_USER_CONFIG.hotkeys, ...(config.hotkeys || {}) }
  delete config.hotkeys?.history
  delete config.hotkeys?.config
  config.submitKey = resolveSubmitKey(config.submitKey)
  delete config.quickInputHotkeys
  delete config.quickInputSubmit
  delete config.quickCorrection
  delete config.hotkeys?.correction
  // only the correction replaces the selection from a hotkey
  config.selectionHotkeys = {
    correction:
      config.selectionHotkeys?.correction ??
      DEFAULT_USER_CONFIG.selectionHotkeys.correction,
  }
  delete config.selectionReplace
  config.quickCorrectionPrefetch = config.quickCorrectionPrefetch === true
  config.quickHideOnBlur = config.quickHideOnBlur !== false
}

function serializeUserConfig(config: unknown) {
  return JSON.stringify(config)
}

function ensurePluginDefaults(config: Record<string, any>) {
  if (!config.plugins) {
    config.plugins = {}
  }

  for (const pluginFactory of pluginIndexes) {
    const plugin = pluginFactory()
    if (!config.plugins[plugin.name]) {
      config.plugins[plugin.name] = {}
    }

    if (config.plugins[plugin.name].enabled === undefined) {
      config.plugins[plugin.name].enabled = true
    }

    if (plugin.defaultConfig?.fields) {
      for (const field of plugin.defaultConfig.fields) {
        if (config.plugins[plugin.name][field.name] === undefined) {
          config.plugins[plugin.name][field.name] = field.defaultValue
        }
      }
    }
  }
}

// configs created before the accessibility settings come without these keys;
// the theme falls back to what the pre-render bootstrap applied
function normalizeAppearanceConfig(config: Record<string, any>) {
  Object.assign(
    config,
    normalizeAppearance({ ...themeStore.settings, ...config })
  )
}

function normalizeLanguageConfig(config: Record<string, any>) {
  config.appLanguage = config.appLanguage || AUTO_LANGUAGE_VALUE
  config.userLanguage = config.userLanguage || AUTO_LANGUAGE_VALUE
  config.toTranslateLanguages = normalizeShortcutSlots<string>(
    config.toTranslateLanguages
  ).map((lang) => (typeof lang === 'string' ? lang : null))
}

function normalizeWindowInsertionConfig(config: Record<string, any>) {
  const defaultWindowInsertion = DEFAULT_USER_CONFIG.windowInsertion
  const windowInsertion = config.windowInsertion || {}
  const xdotoolBin =
    windowInsertion.xdotoolBin ||
    config.xdotoolBin ||
    defaultWindowInsertion.xdotoolBin

  config.windowInsertion = {
    method:
      windowInsertion.method === 'ydotool' ||
      windowInsertion.method === 'xdotool'
        ? windowInsertion.method
        : defaultWindowInsertion.method,
    xdotoolBin,
    ydotoolBin: windowInsertion.ydotoolBin || defaultWindowInsertion.ydotoolBin,
    pasteShortcut: PASTE_SHORTCUTS.includes(windowInsertion.pasteShortcut)
      ? windowInsertion.pasteShortcut
      : defaultWindowInsertion.pasteShortcut,
  }
  config.xdotoolBin = xdotoolBin
}

function normalizeLlmConfigSection(config: Record<string, any>) {
  config.llm = normalizeLlmConfig(config.llm)
  delete config.llmModels
}

function normalizeAiTasks(config: Record<string, any>) {
  if (!Array.isArray(config.aiTasks)) {
    config.aiTasks = []
  }

  config.aiTasks = normalizeShortcutSlots<Record<string, any>>(
    config.aiTasks
  ).map((task) =>
    task ? { name: task.name || '', rule: task.rule || '' } : null
  )
}

/**
 * The field hands over text; the backend expects a number and treats 0 as "keep
 * nothing". A half typed value (empty, negative) is not stored
 */
function setHistoryLimit(
  key: 'editorHistoryMaxItems' | 'chatHistoryMaxItems',
  value: string
) {
  const parsed = Number(value)

  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) return

  userConfig.value[key] = Math.round(parsed)
}

/** Turning the history off is a storage of its own, so the limit stays above 0 */
function setEditorHistoryLimit(value: string) {
  const parsed = Number(value)

  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 1) return

  userConfig.value.editorHistoryMaxItems = Math.round(parsed)
}

function setEditorHistoryRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) return

  userConfig.value.editorHistoryRetentionDays = parsed
}

const navigatorLanguages = computed(() => getNavigatorLanguages())

const isAppLanguageManual = computed(
  () => userConfig.value.appLanguage !== AUTO_LANGUAGE_VALUE
)

const effectiveAppLanguage = computed(() =>
  resolveUiLanguagePreference(
    userConfig.value.appLanguage,
    userConfig.value.userLanguage,
    navigatorLanguages.value
  )
)

async function persistUserConfig() {
  if (configIsNewer.value) return
  const preparedConfig = createPreparedUserConfig(userConfig.value)
  const serializedConfig = serializeUserConfig(preparedConfig)
  saveQueue = saveQueue.then(async () => {
    if (serializedConfig === lastPersistedConfig.value) return
    const previousPersistedConfig = lastPersistedConfig.value

    // Serialize writes so a slower old save can never overwrite a newer edit.
    lastPersistedConfig.value = serializedConfig
    const result = await ipcStore.saveUserConfig(preparedConfig)

    if (!result.success) {
      lastPersistedConfig.value = previousPersistedConfig
      if (isComponentActive) {
        toastText(result.error || t('toast.settingsSaveFailed'), 'error')
      }
    }
  })
  await saveQueue
}

async function finishProviderRemoval(id: string) {
  await persistUserConfig()
  if (
    serializeUserConfig(createPreparedUserConfig(userConfig.value)) !==
    lastPersistedConfig.value
  ) {
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

function scheduleAutosave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    void persistUserConfig()
  }, SAVE_DEBOUNCE_MS)
}

function flushPendingAutosave() {
  if (!saveTimer) {
    return
  }

  clearTimeout(saveTimer)
  saveTimer = null
  void persistUserConfig()
}

const editorHistoryStorageOptions = computed(() => [
  { id: 'disk', name: t('settings.editorHistoryStorageDisk') },
  { id: 'session', name: t('settings.editorHistoryStorageSession') },
  { id: 'off', name: t('settings.editorHistoryStorageOff') },
])

const editorHistoryRetentionOptions = computed(() => {
  const format = new Intl.NumberFormat(toHtmlLang(effectiveAppLanguage.value), {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  })

  return editorHistoryRetentionChoices(
    userConfig.value.editorHistoryRetentionDays
  ).map((days) => ({
    id: days,
    name:
      days === 0
        ? t('settings.editorHistoryRetentionForever')
        : format.format(days),
  }))
})

const pasteShortcutOptions = computed(() => {
  return [
    { id: 'ctrl+v', name: `Ctrl+V — ${t('settings.pasteShortcutRegular')}` },
    {
      id: 'ctrl+shift+v',
      name: `Ctrl+Shift+V — ${t('settings.pasteShortcutTerminals')}`,
    },
    {
      id: 'shift+insert',
      name: `Shift+Insert — ${t('settings.pasteShortcutAnyLayout')}`,
    },
  ]
})

const appLanguageOptions = computed(() => {
  return buildLanguageOptions(
    [effectiveAppLanguage.value, userConfig.value.appLanguage],
    false,
    t,
    SUPPORTED_UI_LANGUAGE_OPTIONS
  )
})

const userLanguageOptions = computed(() => {
  return buildLanguageOptions([userConfig.value.userLanguage], true, t)
})

const getLanguageName = (language: string) =>
  appLanguageOptions.value.find((option) => option.id === language)?.name ||
  language

watch(
  () => [userConfig.value.appLanguage, userConfig.value.userLanguage],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  }
)

const currentSttModel = computed(() => activeSttModel(userConfig.value))

const sttNeedsKey = computed(() =>
  sttProviderNeedsKey(currentSttModel.value.provider)
)

const sttProviderOptions = computed(() => [
  { id: 'deepgram', name: 'Deepgram' },
  { id: 'sherpa-onnx', name: t('settings.sttProviderSherpaOnnx') },
])

const setSttProvider = (value: string | number | undefined) => {
  selectSttProvider(userConfig.value, value as SttProvider)
}

const setSttServerUrl = (value: string) => {
  currentSttModel.value.baseUrl = value.trim()
}

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

/** A new command of the library, placed in the slot it was created from */
const createMenuCommand = (index: number, toolId: BuiltinToolId) => {
  const command = createCommand(toolId)
  const slots = normalizeMainActions(userConfig.value.mainActions)
  slots[index] = { type: 'command', commandId: command.id }
  userConfig.value.commands = [...(userConfig.value.commands ?? []), command]
  userConfig.value.mainActions = slots
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

const updateWindowInsertionMethod = (value: string | number) => {
  if (value !== 'xdotool' && value !== 'ydotool') {
    return
  }

  userConfig.value.windowInsertion.method = value
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

const updateAppLanguage = (value: number | string | undefined) => {
  if (typeof value !== 'string') {
    return
  }

  userConfig.value.appLanguage = value
}

const toggleAppLanguageMode = () => {
  if (isAppLanguageManual.value) {
    userConfig.value.appLanguage = AUTO_LANGUAGE_VALUE
    return
  }

  userConfig.value.appLanguage = effectiveAppLanguage.value
}

const setSttModelName = (value: string) => {
  currentSttModel.value.model = value
}

const hasSttKey = computed(() =>
  Boolean(
    currentSttModel.value &&
    Object.hasOwn(llmStore.secrets, secretId(currentSttModel.value))
  )
)

async function saveSttKey() {
  try {
    await llmStore.setSecret(
      secretId(currentSttModel.value),
      sttKeyDraft.value.trim()
    )
    sttKeyDraft.value = ''
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

async function removeSttKey() {
  try {
    await llmStore.removeSecret(secretId(currentSttModel.value))
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

const setSttFormatWithLlm = (value: boolean) => {
  currentSttModel.value.formatWithLlm = value
}

const setSttLanguage = (value: string | number | undefined) => {
  currentSttModel.value.language = String(value || DICTATION_LANGUAGE_USER)
}

const sttLanguageOptions = computed(() => {
  return [
    { id: DICTATION_LANGUAGE_USER, name: t('settings.sttLanguageUser') },
    { id: DICTATION_LANGUAGE_MULTI, name: t('settings.sttLanguageMulti') },
    ...buildLanguageOptions([], false, t),
  ]
})

async function loadStorageInfo() {
  const result = await ipcStore.callFunction('getStorageInfo')
  storageInfo.value = result.success
    ? (result.result as StorageInfo | null) || null
    : null
}

const updateAiTasks = (items: any[]) => {
  userConfig.value.aiTasks = items
}

const updatePluginEnabled = (pluginName: string, enabled: boolean) => {
  if (!userConfig.value.plugins[pluginName]) {
    userConfig.value.plugins[pluginName] = {}
  }
  userConfig.value.plugins[pluginName].enabled = enabled
  usePlugins().reloadPlugins(userConfig.value)
}

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, any>
) => {
  userConfig.value.plugins[pluginName] = {
    ...userConfig.value.plugins[pluginName],
    ...values,
  }
  usePlugins().reloadPlugins(userConfig.value)
}
onMounted(() => {
  void loadStorageInfo()
  void llmStore.refreshSecrets()
})
onUnmounted(() => {
  if (copyStorageTimeout) {
    clearTimeout(copyStorageTimeout)
  }
  isComponentActive = false
  flushPendingAutosave()
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

.settings-nav-footer {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: auto;
  padding: var(--space-sm);
  font-size: 0.75rem;
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

.editor-history-nested {
  background-color: var(--app-surface-sunken);
  border-top: 1px solid var(--app-border-subtle);
}

.editor-history-group + .field-row {
  border-top: 1px solid var(--app-border-subtle);
}

.storage-details {
  margin-top: var(--space-2xl);
  padding: 0 var(--space-xs);
}

.storage-summary {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--app-text-muted);
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}

.storage-summary:hover {
  color: var(--color-base-content);
}

.storage-details > :not(summary) {
  margin-top: var(--space-md);
}

.storage-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.storage-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.storage-item-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--app-text-muted);
}

.storage-item-hint {
  display: block;
  font-weight: 400;
  color: var(--app-text-muted);
}

.storage-path-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0.375rem 0.5rem 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  border: 1px solid var(--app-border-subtle);
  min-width: 0;
}

.storage-path {
  flex: 1 1 auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-base-content);
  word-break: break-all;
  user-select: all;
  min-width: 0;
}

.storage-path-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
  flex-shrink: 0;
}

.storage-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--app-text-muted);
  opacity: 0.8;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
  transition:
    opacity var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.storage-copy-btn:hover,
.storage-copy-btn:focus-visible {
  opacity: 1;
  background-color: var(--app-hover);
  color: var(--color-base-content);
}

.storage-copy-btn:focus-visible {
  box-shadow: var(--app-focus-ring);
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
  .settings-nav-footer span,
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
