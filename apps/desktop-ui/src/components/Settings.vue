<template>
  <div class="settings-panel">
    <aside class="settings-nav">
      <div class="settings-nav-title">{{ t('nav.settings') }}</div>
      <Tabs :tabs="tabs" v-model:value="currentTab" variant="vertical" />
      <div class="settings-nav-footer">
        <Icon icon="mdi:cloud-check-outline" height="14" />
        <span>{{ t('settings.autosaveHint') }}</span>
      </div>
    </aside>

    <div class="settings-content">
      <div class="settings-content-inner">
        <h1 class="settings-page-title">{{ currentTabTitle }}</h1>

        <div v-show="currentTab === 0">
          <SettingsSection :title="t('settings.sectionAppearance')">
            <FieldRow :label="t('settings.theme')">
              <SegmentedControl
                v-model:value="userConfig.theme"
                :label="t('settings.theme')"
                :options="themeOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.appLanguage')">
              <div class="flex items-center gap-2 w-full">
                <FieldSelect
                  class="flex-1"
                  :value="effectiveAppLanguage"
                  :options="appLanguageOptions"
                  :disabled="!isAppLanguageManual"
                  @update:value="updateAppLanguage"
                />
                <Button sm ghost @click="toggleAppLanguageMode">
                  {{
                    isAppLanguageManual
                      ? t('settings.appLanguageAuto')
                      : t('settings.appLanguageManual')
                  }}
                </Button>
              </div>
            </FieldRow>
            <FieldRow :label="t('settings.userLanguage')">
              <FieldSelect
                v-model:value="userConfig.userLanguage"
                :options="userLanguageOptions"
              />
            </FieldRow>
          </SettingsSection>

          <SettingsSection :title="t('settings.sectionAccessibility')">
            <FieldRow
              :label="t('settings.contrast')"
              :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
            >
              <SegmentedControl
                v-model:value="userConfig.contrast"
                :label="t('settings.contrast')"
                :options="contrastOptions"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.motion')"
              :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
            >
              <SegmentedControl
                v-model:value="userConfig.motion"
                :label="t('settings.motion')"
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

          <SettingsSection :title="t('settings.sectionEditor')">
            <FieldRow :label="t('settings.pasteMode')">
              <FieldSelect
                v-model:value="userConfig.pasteMode"
                :options="pasteModeOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.editorSyntax')">
              <FieldSelect
                v-model:value="userConfig.editorSyntax"
                :options="editorSyntaxOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.showBubbleMenu')">
              <FieldCheckbox v-model:value="userConfig.showBubbleMenu" />
            </FieldRow>
          </SettingsSection>

          <SettingsSection :title="t('settings.sectionHistory')">
            <FieldRow :label="t('settings.editorHistoryMaxItems')">
              <FieldInput
                type="number"
                v-model:value="userConfig.editorHistoryMaxItems"
              />
            </FieldRow>
            <FieldRow :label="t('settings.chatHistoryMaxItems')">
              <FieldInput
                type="number"
                v-model:value="userConfig.chatHistoryMaxItems"
              />
            </FieldRow>
          </SettingsSection>

          <SettingsSection :title="t('settings.sectionSystem')">
            <FieldRow :label="t('settings.windowInsertion')">
              <div class="flex flex-col gap-2 w-full">
                <Tabs
                  variant="segmented"
                  :tabs="windowInsertionTabs"
                  :value="userConfig.windowInsertion.method"
                  @update:value="updateWindowInsertionMethod"
                />
                <FieldInput
                  v-show="userConfig.windowInsertion.method === 'xdotool'"
                  v-model:value="userConfig.windowInsertion.xdotoolBin"
                />
                <FieldInput
                  v-show="userConfig.windowInsertion.method === 'ydotool'"
                  v-model:value="userConfig.windowInsertion.ydotoolBin"
                />
              </div>
            </FieldRow>
            <FieldRow :label="t('settings.storageLocations')" vertical>
              <div v-if="!storageInfo" class="text-sm text-muted">
                {{ t('settings.storageLocationsUnavailable') }}
              </div>
              <dl v-else class="storage-list">
                <template v-for="item in storageInfoItems" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>
                    <code>{{ item.value }}</code>
                  </dd>
                </template>
              </dl>
            </FieldRow>
          </SettingsSection>
        </div>

        <SettingsTranslationsTab
          v-show="currentTab === 1"
          :user-config="userConfig"
          @update:to-translate-languages="updateTranslateLanguages"
        />

        <div v-show="currentTab === 2">
          <SettingsSection>
            <FieldRow :label="t('settings.sttProvider')">
              <Tabs
                variant="segmented"
                :tabs="sttProviderTabs"
                v-model:value="currentSttProvider"
              />
            </FieldRow>
            <FieldRow :label="t('settings.baseUrl')">
              <FieldInput
                :value="currentSttModel.baseUrl || ''"
                :placeholder="
                  currentSttProvider === 'websocket'
                    ? 'ws://localhost:2700'
                    : 'http://localhost:8000/v1'
                "
                @update:value="setSttField('baseUrl', $event)"
              />
            </FieldRow>
            <FieldRow :label="t('settings.model')">
              <FieldInput
                :value="currentSttModel.model || ''"
                placeholder="whisper-1"
                @update:value="setSttField('model', $event)"
              />
            </FieldRow>
            <FieldRow
              v-if="currentSttProvider === 'openai-compatible'"
              :label="t('settings.apiKey')"
            >
              <FieldInput
                type="password"
                :value="currentSttModel.apiKey || ''"
                @update:value="setSttField('apiKey', $event)"
              />
            </FieldRow>
            <FieldRow :label="t('settings.formatWithLlm')">
              <FieldCheckbox
                :value="currentSttModel.formatWithLlm !== false"
                @update:value="setSttFormatWithLlm"
              />
            </FieldRow>
          </SettingsSection>
        </div>

        <div v-show="currentTab === 3">
          <SettingsSection
            :title="t('settings.llmModels')"
            :description="t('settings.openAiCompatibleHint')"
            bare
          >
            <template #actions>
              <Button sm icon="mdi:plus" @click="addOpenAiCompatibleLlmModel">
                {{ t('settings.addOpenAiCompatibleModel') }}
              </Button>
            </template>

            <div class="flex flex-col gap-3">
              <div
                v-for="(model, index) in userConfig.llmModels"
                :key="model.id"
                class="surface model-card"
              >
                <div class="model-card-header">
                  <div class="flex items-center gap-2 min-w-0">
                    <Icon
                      icon="mdi:cube-outline"
                      height="18"
                      class="text-muted shrink-0"
                    />
                    <span class="font-medium truncate">
                      {{ modelDisplayName(model, index) }}
                    </span>
                  </div>
                  <Button
                    sm
                    ghost
                    icon="mdi:trash-can-outline"
                    class="danger-ghost"
                    :disabled="userConfig.llmModels.length <= 1"
                    @click="removeLlmModel(model.id)"
                  >
                    {{ t('settings.removeModel') }}
                  </Button>
                </div>

                <FieldRow :label="t('settings.name')">
                  <FieldInput
                    :value="model.name || ''"
                    @update:value="setLlmModelName(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.baseUrl')">
                  <FieldInput
                    :value="model.baseUrl || ''"
                    placeholder="https://openrouter.ai/api/v1"
                    @update:value="setOpenAiCompatibleBaseUrl(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.apiKey')">
                  <FieldInput
                    type="password"
                    :value="model.apiKey || ''"
                    @update:value="setOpenAiCompatibleApiKey(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.model')">
                  <FieldInput
                    :value="model.model || ''"
                    placeholder="openai/gpt-4.1-mini"
                    @update:value="setOpenAiCompatibleModel(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.temperature')">
                  <FieldInput
                    type="number"
                    :value="String(model.temperature ?? 0.2)"
                    @update:value="setLlmTemperature(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.maxTokens')">
                  <FieldInput
                    type="number"
                    :value="String(model.maxTokens ?? 512)"
                    @update:value="setLlmMaxTokens(model.id, $event)"
                  />
                </FieldRow>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            :title="t('settings.aiModelUsage')"
            :description="t('settings.aiModelUsageHint')"
          >
            <FieldRow :label="t('settings.translate')">
              <FieldSelect
                v-model:value="userConfig.aiModelUsage.translate"
                :options="llmUsageOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.voiceCorrection')">
              <FieldSelect
                v-model:value="userConfig.aiModelUsage.voiceCorrection"
                :options="llmUsageOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.correction')">
              <FieldSelect
                v-model:value="userConfig.aiModelUsage.correction"
                :options="llmUsageOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.aiTasks')">
              <FieldSelect
                v-model:value="userConfig.aiModelUsage.aiTasks"
                :options="llmUsageOptions"
              />
            </FieldRow>
            <FieldRow :label="t('settings.chat')">
              <FieldSelect
                v-model:value="userConfig.aiModelUsage.chat"
                :options="llmUsageOptions"
              />
            </FieldRow>
          </SettingsSection>
        </div>

        <SettingsRulesTab v-show="currentTab === 4" :user-config="userConfig" />

        <SettingsTasksTab
          v-show="currentTab === 5"
          :user-config="userConfig"
          @update:ai-tasks="updateAiTasks"
        />

        <SettingsRolesTab
          v-show="currentTab === 6"
          :user-config="userConfig"
          @update:chat-roles="updateChatRoles"
        />

        <SettingsPluginsTab
          v-show="currentTab === 7"
          :user-config="userConfig"
          @update:plugin-config="updatePluginConfig"
          @update:plugin-enabled="updatePluginEnabled"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { syncI18nLocale } from '../lib/i18n'
import {
  AUTO_LANGUAGE_VALUE,
  DEFAULT_LANGUAGE,
  SUPPORTED_UI_LANGUAGE_OPTIONS,
  buildLanguageOptions,
  getNavigatorLanguages,
  normalizeLocale,
  resolveUiLanguagePreference,
} from '../lib/locale/language'
import { pluginIndexes, usePlugins } from '../plugins'
import { useIpcStore } from '../stores/ipc'
import { useThemeStore } from '../stores/theme'
import SettingsPluginsTab from './settings/SettingsPluginsTab.vue'
import SettingsRolesTab from './settings/SettingsRolesTab.vue'
import SettingsRulesTab from './settings/SettingsRulesTab.vue'
import SettingsTasksTab from './settings/SettingsTasksTab.vue'
import SettingsTranslationsTab from './settings/SettingsTranslationsTab.vue'
import { Icon } from '@iconify/vue'
import {
  type ContrastMode,
  DEFAULT_USER_CONFIG,
  type MotionMode,
  type StorageInfo,
  type ThemeMode,
  UI_SCALES,
  isUiScale,
  normalizeAppearance,
} from '@tyco/shared'

const ipcStore = useIpcStore()
const themeStore = useThemeStore()
const { t, locale } = useI18n()
const { toast } = useToast()

const SAVE_DEBOUNCE_MS = 500

const currentTab = ref(0)
const currentSttProvider = ref<'openai-compatible' | 'websocket'>(
  'openai-compatible'
)
const userConfig = ref(createPreparedUserConfig(ipcStore.params.userConfig))
const lastPersistedConfig = ref(serializeUserConfig(userConfig.value))
const storageInfo = ref<StorageInfo | null>(null)
let isComponentActive = true
let skipNextAutosave = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const tabs = computed(() => [
  { text: t('settings.generalTab'), key: 0, icon: 'mdi:tune-variant' },
  { text: t('settings.translationsTab'), key: 1, icon: 'mdi:translate' },
  { text: t('settings.sttTab'), key: 2, icon: 'mdi:microphone-outline' },
  { text: t('settings.llmTab'), key: 3, icon: 'mdi:cube-outline' },
  { text: t('settings.rulesTab'), key: 4, icon: 'mdi:script-text-outline' },
  { text: t('settings.tasksTab'), key: 5, icon: 'mdi:robot-outline' },
  { text: t('settings.rolesTab'), key: 6, icon: 'mdi:account-voice' },
  { text: t('settings.pluginsTab'), key: 7, icon: 'mdi:puzzle-outline' },
])

const currentTabTitle = computed(
  () => tabs.value.find((tab) => tab.key === currentTab.value)?.text || ''
)

const sttProviderTabs = computed(() => [
  { text: 'OpenAI-compatible', key: 'openai-compatible' },
  { text: 'WebSocket', key: 'websocket' },
])

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

watch(
  () => userConfig.value.aiModelUsage?.stt,
  () => {
    currentSttProvider.value = resolveCurrentSttProvider(userConfig.value)
  },
  { immediate: true }
)

watch(
  () => currentSttProvider.value,
  (provider) => {
    if (provider === resolveCurrentSttProvider(userConfig.value)) {
      return
    }

    const model = ensureSttModel(userConfig.value, provider)
    userConfig.value.aiModelUsage.stt = model.id
  }
)

const storageInfoItems = computed(() => {
  if (!storageInfo.value) {
    return []
  }

  return [
    {
      label: t('settings.storageUserConfig'),
      value: storageInfo.value.userConfigFile,
    },
    { label: t('settings.storageData'), value: storageInfo.value.dataDir },
    {
      label: t('settings.storageHistory'),
      value: storageInfo.value.historyDir,
    },
    { label: t('settings.storageChats'), value: storageInfo.value.chatsDir },
    { label: t('settings.storageCache'), value: storageInfo.value.cacheDir },
  ]
})

function cloneUserConfig(config: unknown) {
  return JSON.parse(JSON.stringify(config || DEFAULT_USER_CONFIG))
}

function createPreparedUserConfig(config: unknown) {
  const nextConfig = cloneUserConfig(config)

  ensurePluginDefaults(nextConfig)
  normalizeAppearanceConfig(nextConfig)
  normalizeLanguageConfig(nextConfig)
  normalizeWindowInsertionConfig(nextConfig)
  normalizeEditorConfig(nextConfig)
  normalizeSttConfig(nextConfig)
  normalizeLlmConfig(nextConfig)
  normalizeChatRoles(nextConfig)
  normalizeAiTasks(nextConfig)

  return nextConfig
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
  config.toTranslateLanguages = (config.toTranslateLanguages || []).map(
    (lang: string) => lang || DEFAULT_LANGUAGE
  )
}

// конфиги, созданные до появления настроек редактора, приходят без этих ключей
function normalizeEditorConfig(config: Record<string, any>) {
  config.pasteMode = config.pasteMode ?? DEFAULT_USER_CONFIG.pasteMode
  config.editorSyntax = config.editorSyntax ?? DEFAULT_USER_CONFIG.editorSyntax
  config.showBubbleMenu =
    config.showBubbleMenu ?? DEFAULT_USER_CONFIG.showBubbleMenu
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
  }
  config.xdotoolBin = xdotoolBin
}

function normalizeSttConfig(config: Record<string, any>) {
  if (!Array.isArray(config.sttModels)) {
    config.sttModels = []
  }

  if (!config.aiModelUsage) {
    config.aiModelUsage = {}
  }

  const activeModel = config.sttModels.find(
    (model: Record<string, any>) => model.id === config.aiModelUsage.stt
  )
  const activeProvider = activeModel?.provider
  const oldHttpModel = config.sttModels.find(
    (model: Record<string, any>) => model.provider === 'openai-compatible'
  )
  const oldWebSocketModel = config.sttModels.find(
    (model: Record<string, any>) => model.provider === 'websocket'
  )
  const httpModel = createSttModel('openai-compatible', oldHttpModel)
  const webSocketModel = createSttModel('websocket', oldWebSocketModel)

  config.sttModels = [httpModel, webSocketModel]
  config.aiModelUsage.stt =
    activeProvider === 'websocket' ? webSocketModel.id : httpModel.id
}

function normalizeLlmConfig(config: Record<string, any>) {
  if (!Array.isArray(config.llmModels)) {
    config.llmModels = []
  }

  if (!config.aiModelUsage) {
    config.aiModelUsage = {}
  }

  const normalizedModels = config.llmModels
    .map((model: Record<string, any>) => normalizeSingleLlmModel(model))
    .filter((model: Record<string, any> | null) => model !== null)
  const dedupedModels = dedupeLlmModels(
    normalizedModels as Record<string, any>[]
  )
  const llmModels =
    dedupedModels.length > 0 ? dedupedModels : [createOpenAiCompatibleModel()]

  config.llmModels = llmModels

  const usageKeys = [
    'translate',
    'voiceCorrection',
    'correction',
    'aiTasks',
    'chat',
  ] as const

  const validIds = new Set(
    llmModels.map((model: Record<string, any>) => model.id)
  )
  const fallbackModelId = llmModels[0].id

  for (const usageKey of usageKeys) {
    const currentId = config.aiModelUsage[usageKey]
    config.aiModelUsage[usageKey] = validIds.has(currentId)
      ? currentId
      : fallbackModelId
  }
}

function normalizeChatRoles(config: Record<string, any>) {
  if (!Array.isArray(config.chatRoles)) {
    config.chatRoles = []
  }

  config.chatRoles = config.chatRoles.map((role: Record<string, any>) => ({
    name: role.name || '',
    rule: role.rule || '',
  }))
}

function normalizeAiTasks(config: Record<string, any>) {
  if (!Array.isArray(config.aiTasks)) {
    config.aiTasks = []
  }

  config.aiTasks = config.aiTasks.map((task: Record<string, any>) => ({
    name: task.name || '',
    rule: task.rule || '',
  }))
}

function createSttModel(
  provider: 'openai-compatible' | 'websocket',
  existingModel?: Record<string, any>
) {
  const isWebSocket = provider === 'websocket'
  return {
    id: isWebSocket ? 'websocket-stt' : 'openai-compatible-stt',
    model: existingModel?.model || (isWebSocket ? 'whisper' : 'whisper-1'),
    provider,
    description: isWebSocket
      ? 'Streaming STT WebSocket endpoint'
      : 'OpenAI-compatible transcription endpoint',
    formatWithLlm: existingModel?.formatWithLlm ?? isWebSocket,
    baseUrl:
      existingModel?.baseUrl ||
      (isWebSocket ? 'ws://localhost:2700' : 'http://localhost:8000/v1'),
    apiKey: isWebSocket ? undefined : existingModel?.apiKey || '',
  }
}

function createOpenAiCompatibleModel(existingModel?: Record<string, any>) {
  return {
    id: existingModel?.id || createLlmModelId('openai-compatible'),
    name:
      existingModel?.name ||
      existingModel?.label ||
      t('settings.openAiCompatibleModelDefaultName'),
    model: existingModel?.model || '',
    provider: 'openai-compatible',
    description:
      existingModel?.description || t('settings.openAiCompatibleDescription'),
    baseUrl: existingModel?.baseUrl || '',
    apiKey: existingModel?.apiKey || '',
    temperature: toNumberOrDefault(existingModel?.temperature, 0.2),
    maxTokens: toIntegerOrDefault(existingModel?.maxTokens, 512),
  }
}

function ensureSttModel(
  config: Record<string, any>,
  provider: 'openai-compatible' | 'websocket'
) {
  const existingModel = (config.sttModels || []).find(
    (model: Record<string, any>) => model.provider === provider
  )
  const nextModel = createSttModel(provider, existingModel)

  config.sttModels = (config.sttModels || []).map(
    (model: Record<string, any>) =>
      model.provider === provider ? nextModel : model
  )
  return nextModel
}

function resolveCurrentSttProvider(config: Record<string, any>) {
  const usageId = config.aiModelUsage?.stt
  const model = (config.sttModels || []).find(
    (item: Record<string, any>) => item.id === usageId
  )

  return model?.provider === 'websocket' ? 'websocket' : 'openai-compatible'
}

function normalizeSingleLlmModel(model: Record<string, any>) {
  if (model.provider === 'openai-compatible') {
    return createOpenAiCompatibleModel(model)
  }

  return null
}

function dedupeLlmModels(models: Record<string, any>[]) {
  const usedIds = new Set<string>()

  return models.map((model) => {
    let nextId =
      typeof model.id === 'string' && model.id.trim()
        ? model.id.trim()
        : createLlmModelId(model.provider)

    while (usedIds.has(nextId)) {
      nextId = createLlmModelId(model.provider)
    }

    usedIds.add(nextId)
    return { ...model, id: nextId }
  })
}

function createLlmModelId(provider: string) {
  return `${provider}-${Math.random().toString(36).slice(2, 10)}`
}

function toNumberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function toIntegerOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
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
  const preparedConfig = createPreparedUserConfig(userConfig.value)
  const serializedConfig = serializeUserConfig(preparedConfig)
  const previousPersistedConfig = lastPersistedConfig.value

  if (serializedConfig === lastPersistedConfig.value) {
    return
  }

  // Mark this snapshot as persisted before the store echoes it back into params.
  lastPersistedConfig.value = serializedConfig
  const result = await ipcStore.saveUserConfig(preparedConfig)

  if (!result.success) {
    lastPersistedConfig.value = previousPersistedConfig

    if (isComponentActive) {
      toast(result.error || t('toast.settingsSaveFailed'), 'error')
    }
    return
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

const pasteModeOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return [
    { id: 'markdown', name: t('settings.pasteModeMarkdown') },
    { id: 'plain', name: t('settings.pasteModePlain') },
    { id: 'ask', name: t('settings.pasteModeAsk') },
  ]
})

const editorSyntaxOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return [
    { id: 'markdown', name: t('settings.editorSyntaxMarkdown') },
    { id: 'none', name: t('settings.editorSyntaxNone') },
  ]
})

const appLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions(
    [effectiveAppLanguage.value, userConfig.value.appLanguage],
    false,
    t,
    SUPPORTED_UI_LANGUAGE_OPTIONS
  )
})

const userLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions([userConfig.value.userLanguage], true, t)
})

watch(
  () => [userConfig.value.appLanguage, userConfig.value.userLanguage],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  }
)

const currentSttModel = computed(() =>
  (userConfig.value.sttModels || []).find(
    (model: Record<string, any>) => model.provider === currentSttProvider.value
  )
)

const llmUsageOptions = computed(() => {
  return (userConfig.value.llmModels || []).map(
    (model: Record<string, any>, index: number) => ({
      id: model.id,
      name: modelDisplayName(model, index),
    })
  )
})

const updateTranslateLanguages = (languages: string[]) => {
  userConfig.value.toTranslateLanguages = languages
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

const setSttField = (field: 'baseUrl' | 'model' | 'apiKey', value: string) => {
  currentSttModel.value[field] = value
}

const setSttFormatWithLlm = (value: boolean) => {
  currentSttModel.value.formatWithLlm = value
}

function modelDisplayName(model: Record<string, any>, index: number | string) {
  const customName = String(model.name || '').trim()
  const displayIndex = Number(index) + 1

  if (customName) {
    return customName
  }

  return `${t('settings.openAiCompatible')} ${displayIndex}`
}

function getLlmModelById(modelId: string) {
  return (userConfig.value.llmModels || []).find(
    (model: Record<string, any>) => model.id === modelId
  )
}

function setLlmModelName(modelId: string, value: string) {
  const model = getLlmModelById(modelId)

  if (!model) {
    return
  }

  model.name = value
}

function addOpenAiCompatibleLlmModel() {
  userConfig.value.llmModels.push(createOpenAiCompatibleModel())
}

function removeLlmModel(modelId: string) {
  const nextModels = userConfig.value.llmModels.filter(
    (model: Record<string, any>) => model.id !== modelId
  )

  if (nextModels.length === 0) {
    nextModels.push(createOpenAiCompatibleModel())
  }

  userConfig.value.llmModels = nextModels
  const fallbackModelId = nextModels[0].id
  const usageKeys = [
    'translate',
    'voiceCorrection',
    'correction',
    'aiTasks',
    'chat',
  ] as const

  for (const usageKey of usageKeys) {
    if (userConfig.value.aiModelUsage[usageKey] === modelId) {
      userConfig.value.aiModelUsage[usageKey] = fallbackModelId
    }
  }
}

const setOpenAiCompatibleBaseUrl = (modelId: string, baseUrl: string) => {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'openai-compatible') {
    return
  }

  model.baseUrl = baseUrl
}

const setOpenAiCompatibleApiKey = (modelId: string, apiKey: string) => {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'openai-compatible') {
    return
  }

  model.apiKey = apiKey
}

const setOpenAiCompatibleModel = (modelId: string, value: string) => {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'openai-compatible') {
    return
  }

  model.model = value
}

const setLlmTemperature = (modelId: string, value: string) => {
  const model = getLlmModelById(modelId)

  if (!model) {
    return
  }

  model.temperature = toNumberOrDefault(value, 0.2)
}

const setLlmMaxTokens = (modelId: string, value: string) => {
  const model = getLlmModelById(modelId)

  if (!model) {
    return
  }

  model.maxTokens = toIntegerOrDefault(value, 512)
}

async function loadStorageInfo() {
  const result = await ipcStore.callFunction('getStorageInfo')
  storageInfo.value = result.success
    ? (result.result as StorageInfo | null) || null
    : null
}

const updateAiTasks = (items: any[]) => {
  userConfig.value.aiTasks = items
}

const updateChatRoles = (items: any[]) => {
  userConfig.value.chatRoles = items
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
})
onUnmounted(() => {
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
  margin: 0 0 var(--space-xl);
  font-size: 1.25rem;
  font-weight: 600;
}

.model-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}

.model-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.danger-ghost:not(:disabled):hover {
  color: var(--color-error);
}

.storage-list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.375rem var(--space-lg);
  width: 100%;
  margin: 0;
  font-size: 0.8125rem;
}

.storage-list dt {
  color: var(--app-text-muted);
}

.storage-list dd {
  margin: 0;
  min-width: 0;
}

.storage-list code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  word-break: break-all;
}

@media (max-width: 720px) {
  .settings-nav {
    width: 64px;
    padding-inline: var(--space-sm);
  }

  .settings-nav-title,
  .settings-nav-footer span,
  .settings-nav :deep(.app-tab .truncate) {
    display: none;
  }

  .settings-nav :deep(.app-tab) {
    justify-content: center;
  }
}
</style>
