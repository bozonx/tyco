<template>
  <div class="settings-panel flex flex-col gap-3 w-full h-full">
    <Tabs :tabs="tabs" v-model:value="currentTab" />

    <div class="flex-1 overflow-y-auto">
      <div v-show="currentTab === 0" class="fields-col">
        <FieldRow :label="t('settings.theme')">
          <ThemeSwitcher v-model:value="userConfig.theme" />
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
              class="flex-1"
              :value="effectiveAppLanguage"
              :options="appLanguageOptions"
              :disabled="!isAppLanguageManual"
              @update:value="updateAppLanguage"
            />
            <button
              type="button"
              class="text-sm underline underline-offset-2 disabled:no-underline opacity-80 hover:opacity-100"
              @click="toggleAppLanguageMode"
            >
              {{
                isAppLanguageManual
                  ? t('settings.appLanguageAuto')
                  : t('settings.appLanguageManual')
              }}
            </button>
          </div>
        </FieldRow>
        <FieldRow :label="t('settings.editorHistoryMaxItems')">
          <FieldInput
            type="number"
            v-model:value="userConfig.editorHistoryMaxItems"
          />
        </FieldRow>
        <FieldRow :label="t('settings.transformHistoryMaxItems')">
          <FieldInput
            type="number"
            v-model:value="userConfig.transformHistoryMaxItems"
          />
        </FieldRow>
        <FieldRow :label="t('settings.chatHistoryMaxItems')">
          <FieldInput
            type="number"
            v-model:value="userConfig.chatHistoryMaxItems"
          />
        </FieldRow>

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

        <FieldRow :label="t('settings.windowInsertion')" vertical>
          <div class="flex flex-col gap-3 w-full">
            <Tabs
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
          <div class="flex flex-col gap-2 text-xs w-full">
            <div v-if="!storageInfo" class="text-muted">
              {{ t('settings.storageLocationsUnavailable') }}
            </div>
            <template v-else>
              <div
                v-for="item in storageInfoItems"
                :key="item.label"
                class="grid grid-cols-[140px_1fr] gap-2"
              >
                <span class="text-muted">{{ item.label }}</span>
                <code class="break-all">{{ item.value }}</code>
              </div>
            </template>
          </div>
        </FieldRow>
      </div>

      <SettingsTranslationsTab
        v-show="currentTab === 1"
        :user-config="userConfig"
        @update:to-translate-languages="updateTranslateLanguages"
      />

      <div v-show="currentTab === 2" class="fields-col">
        <FieldRow :label="t('settings.sttProvider')" vertical>
          <Tabs :tabs="sttProviderTabs" v-model:value="currentSttProvider" />
        </FieldRow>
        <FieldRow :label="t('settings.baseUrl')" vertical>
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
        <FieldRow :label="t('settings.model')" vertical>
          <FieldInput
            :value="currentSttModel.model || ''"
            placeholder="whisper-1"
            @update:value="setSttField('model', $event)"
          />
        </FieldRow>
        <FieldRow
          v-if="currentSttProvider === 'openai-compatible'"
          :label="t('settings.apiKey')"
          vertical
        >
          <FieldInput
            :value="currentSttModel.apiKey || ''"
            @update:value="setSttField('apiKey', $event)"
          />
        </FieldRow>
        <FieldRow :label="t('settings.formatWithLlm')">
          <FieldCheckbox
            :value="currentSttModel.formatWithLlm !== false"
            :label="t('settings.formatWithLlm')"
            @update:value="setSttFormatWithLlm"
          />
        </FieldRow>
      </div>

      <div v-show="currentTab === 3" class="fields-col">
        <FieldRow :label="t('settings.llmModels')" vertical>
          <div class="flex flex-col gap-3 w-full">
            <div class="flex flex-wrap gap-2">
              <Button sm @click="addOpenAiCompatibleLlmModel">
                {{ t('settings.addOpenAiCompatibleModel') }}
              </Button>
            </div>

            <div
              v-for="(model, index) in userConfig.llmModels"
              :key="model.id"
              class="flex flex-col gap-3 p-3 rounded-box border border-base-300"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="font-medium">
                  {{ modelDisplayName(model, index) }}
                </div>
                <Button
                  sm
                  neutral
                  :disabled="userConfig.llmModels.length <= 1"
                  @click="removeLlmModel(model.id)"
                >
                  {{ t('settings.removeModel') }}
                </Button>
              </div>

              <FieldRow :label="t('settings.name')" vertical>
                <FieldInput
                  :value="model.name || ''"
                  @update:value="setLlmModelName(model.id, $event)"
                />
              </FieldRow>

              <FieldRow :label="t('settings.baseUrl')" vertical>
                <FieldInput
                  :value="model.baseUrl || ''"
                  placeholder="https://openrouter.ai/api/v1"
                  @update:value="setOpenAiCompatibleBaseUrl(model.id, $event)"
                />
              </FieldRow>
              <FieldRow :label="t('settings.apiKey')" vertical>
                <FieldInput
                  :value="model.apiKey || ''"
                  @update:value="setOpenAiCompatibleApiKey(model.id, $event)"
                />
              </FieldRow>
              <FieldRow :label="t('settings.model')" vertical>
                <FieldInput
                  :value="model.model || ''"
                  placeholder="openai/gpt-4.1-mini"
                  @update:value="setOpenAiCompatibleModel(model.id, $event)"
                />
              </FieldRow>
              <FieldRow :label="t('settings.temperature')" vertical>
                <FieldInput
                  :value="String(model.temperature ?? 0.2)"
                  @update:value="setLlmTemperature(model.id, $event)"
                />
              </FieldRow>
              <FieldRow :label="t('settings.maxTokens')" vertical>
                <FieldInput
                  :value="String(model.maxTokens ?? 512)"
                  @update:value="setLlmMaxTokens(model.id, $event)"
                />
              </FieldRow>
              <div class="text-xs text-muted whitespace-pre-wrap">
                {{ t('settings.openAiCompatibleHint') }}
              </div>
            </div>
          </div>
        </FieldRow>

        <h2>{{ t('settings.aiModelUsage') }}</h2>
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
import { DEFAULT_USER_CONFIG, type StorageInfo } from '@tyco/shared'

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
  { text: t('settings.generalTab'), key: 0 },
  { text: t('settings.translationsTab'), key: 1 },
  { text: t('settings.sttTab'), key: 2 },
  { text: t('settings.llmTab'), key: 3 },
  { text: t('settings.rulesTab'), key: 4 },
  { text: t('settings.tasksTab'), key: 5 },
  { text: t('settings.rolesTab'), key: 6 },
  { text: t('settings.pluginsTab'), key: 7 },
])

const sttProviderTabs = computed(() => [
  { text: 'OpenAI-compatible', key: 'openai-compatible' },
  { text: 'WebSocket', key: 'websocket' },
])

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

function normalizeLanguageConfig(config: Record<string, any>) {
  config.theme = config.theme || themeStore.themeMode
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
.settings-panel :deep(.field-row) {
  padding-top: 0.4375rem;
  padding-bottom: 0.4375rem;
}

.settings-panel :deep(.field-row-label) {
  line-height: 1.875rem;
}

.settings-panel :deep(.input),
.settings-panel :deep(.select) {
  min-height: 2rem;
  height: 2rem;
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
  font-size: 0.8125rem;
}

.settings-panel :deep(.textarea) {
  min-height: 5.5rem;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  font-size: 0.8125rem;
}

.settings-panel :deep(.tabs) {
  gap: 0.125rem;
}
</style>
