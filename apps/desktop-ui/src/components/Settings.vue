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

      <div v-show="currentTab === 1" class="fields-col">
        <FieldRow :label="t('settings.translateLanguages')">
          <FieldItems
            :items="translateLanguagesItems"
            @update:items="updateTranslateLanguages"
          >
            <template #item="{ item, index }">
              <div class="flex flex-row gap-2 w-full">
                <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
                <FieldSelect
                  class="flex-1"
                  v-model:value="item.value"
                  :options="translateLanguageOptions"
                />
              </div>
            </template>
          </FieldItems>
        </FieldRow>
      </div>

      <div v-show="currentTab === 2" class="fields-col">
        <FieldRow :label="t('settings.sttProvider')" vertical>
          <Tabs :tabs="sttProviderTabs" v-model:value="currentSttProvider" />
        </FieldRow>

        <div v-show="currentSttProvider === 'whisper-local'">
          <FieldRow :label="t('settings.whisperLocal')" vertical>
            <div class="flex flex-col gap-3 w-full">
              <FieldCheckbox
                :value="whisperLocalConfig.formatWithLlm !== false"
                :label="t('settings.formatWithLlm')"
                @update:value="setWhisperFormatWithLlm"
              />
              <FieldRow :label="t('settings.whisperLocalModel')" vertical>
                <FieldSelect
                  :value="whisperLocalModel"
                  :options="WHISPER_LOCAL_MODELS"
                  @update:value="setWhisperLocalModel"
                />
              </FieldRow>
              <div class="flex flex-col gap-2 text-sm">
                <div>
                  {{
                    isWhisperModelDownloaded
                      ? t('settings.whisperLocalDownloaded')
                      : isWhisperModelPartiallyDownloaded
                        ? t('settings.whisperLocalPartial')
                        : t('settings.whisperLocalNotDownloaded')
                  }}
                </div>
                <div class="text-xs text-muted">
                  {{ t('settings.whisperLocalStorageHint') }}
                </div>
                <div
                  v-if="whisperModelMetadata"
                  class="flex flex-col gap-1 text-xs text-muted"
                >
                  <div>
                    {{ t('settings.whisperLocalVersion') }}:
                    {{ whisperModelMetadata.version }}
                  </div>
                  <div>
                    {{ t('settings.whisperLocalDownloadedAt') }}:
                    {{ whisperModelDownloadedAt }}
                  </div>
                </div>
                <div
                  v-if="downloadState.error"
                  class="text-error text-xs whitespace-pre-wrap"
                >
                  {{ downloadState.error }}
                </div>
                <div
                  v-if="downloadState.loading"
                  class="flex flex-col gap-1 text-xs text-muted"
                >
                  <div class="flex justify-between gap-2">
                    <span
                      >{{ downloadState.status }}:
                      {{ downloadState.file }}</span
                    >
                    <span>{{ Math.round(downloadState.progress) }}%</span>
                  </div>
                  <progress
                    class="progress progress-primary w-full"
                    :value="downloadState.progress"
                    max="100"
                  />
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button
                    v-if="
                      !isWhisperModelDownloaded ||
                      isWhisperModelPartiallyDownloaded
                    "
                    sm
                    :disabled="downloadState.loading"
                    @click="downloadWhisperModel"
                  >
                    {{
                      isWhisperModelPartiallyDownloaded
                        ? t('settings.whisperLocalResume')
                        : t('settings.whisperLocalDownload')
                    }}
                  </Button>
                  <span v-if="isWhisperModelDownloaded" class="text-success">
                    {{ t('settings.whisperLocalReady') }}
                  </span>
                  <Button
                    v-if="
                      (isWhisperModelDownloaded ||
                        isWhisperModelPartiallyDownloaded) &&
                      !downloadState.loading
                    "
                    sm
                    neutral
                    @click="deleteWhisperModel"
                  >
                    {{ t('settings.whisperLocalDelete') }}
                  </Button>
                </div>
              </div>
            </div>
          </FieldRow>
        </div>

        <div v-show="currentSttProvider === 'vosk'">
          <FieldRow :label="t('settings.voskWsUrl')">
            <FieldInput
              :value="voskWsUrl"
              placeholder="ws://localhost:2700"
              @update:value="setVoskWsUrl"
            />
          </FieldRow>
          <FieldRow :label="t('settings.formatWithLlm')">
            <FieldCheckbox
              :value="voskConfig.formatWithLlm !== false"
              :label="t('settings.formatWithLlm')"
              @update:value="setVoskFormatWithLlm"
            />
          </FieldRow>
        </div>
      </div>

      <div v-show="currentTab === 3" class="fields-col">
        <FieldRow :label="t('settings.llmModels')" vertical>
          <div class="flex flex-col gap-3 w-full">
            <div class="flex flex-wrap gap-2">
              <Button sm @click="addBrowserLocalLlmModel">
                {{ t('settings.addBrowserLocalModel') }}
              </Button>
              <Button sm neutral @click="addOllamaLlmModel">
                {{ t('settings.addOllamaModel') }}
              </Button>
              <Button sm neutral @click="addOpenAiCompatibleLlmModel">
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

              <FieldRow :label="t('settings.llmProvider')" vertical>
                <div class="text-sm text-muted">
                  {{
                    model.provider === 'ollama'
                      ? t('settings.ollama')
                      : model.provider === 'openai-compatible'
                        ? t('settings.openAiCompatible')
                        : t('settings.browserLocalLlm')
                  }}
                </div>
              </FieldRow>

              <template v-if="model.provider === 'browser-local'">
                <FieldRow :label="t('settings.browserLocalLlmModel')" vertical>
                  <FieldSelect
                    :value="model.localModel || DEFAULT_BROWSER_LLM_MODEL"
                    :options="BROWSER_LLM_MODELS"
                    @update:value="setBrowserLocalModel(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.temperature')" vertical>
                  <FieldInput
                    :value="String(model.temperature ?? 0.2)"
                    @update:value="setBrowserLocalTemperature(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.maxTokens')" vertical>
                  <FieldInput
                    :value="String(model.maxTokens ?? 256)"
                    @update:value="setBrowserLocalMaxTokens(model.id, $event)"
                  />
                </FieldRow>
                <div class="flex flex-col gap-2 text-sm">
                  <div>
                    {{
                      browserLocalStatusById[model.id]?.downloaded
                        ? t('settings.browserLocalLlmDownloaded')
                        : browserLocalStatusById[model.id]?.partial
                          ? t('settings.browserLocalLlmPartial')
                          : t('settings.browserLocalLlmNotDownloaded')
                    }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ t('settings.browserLocalLlmStorageHint') }}
                  </div>
                  <div
                    v-if="browserLocalStatusById[model.id]?.metadata"
                    class="flex flex-col gap-1 text-xs text-muted"
                  >
                    <div>
                      {{ t('settings.browserLocalLlmVersion') }}:
                      {{ browserLocalStatusById[model.id]?.metadata?.version }}
                    </div>
                    <div>
                      {{ t('settings.browserLocalLlmDownloadedAt') }}:
                      {{
                        formatDownloadedAt(
                          browserLocalStatusById[model.id]?.metadata
                            ?.downloadedAt
                        )
                      }}
                    </div>
                  </div>
                  <div
                    v-if="browserLocalDownloadStateById[model.id]?.error"
                    class="text-error text-xs whitespace-pre-wrap"
                  >
                    {{ browserLocalDownloadStateById[model.id]?.error }}
                  </div>
                  <div
                    v-if="browserLocalDownloadStateById[model.id]?.loading"
                    class="flex flex-col gap-1 text-xs text-muted"
                  >
                    <div class="flex justify-between gap-2">
                      <span>
                        {{ browserLocalDownloadStateById[model.id]?.status }}:
                        {{
                          browserLocalDownloadStateById[model.id]?.fileCount
                            ? `${browserLocalDownloadStateById[model.id]?.fileIndex + 1}/${browserLocalDownloadStateById[model.id]?.fileCount}`
                            : ''
                        }}
                        {{ browserLocalDownloadStateById[model.id]?.file }}
                      </span>
                      <span>
                        {{
                          Math.round(
                            browserLocalDownloadStateById[model.id]?.progress ||
                              0
                          )
                        }}%
                      </span>
                    </div>
                    <progress
                      class="progress progress-primary w-full"
                      :value="
                        browserLocalDownloadStateById[model.id]?.progress || 0
                      "
                      max="100"
                    />
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      v-if="
                        !browserLocalStatusById[model.id]?.downloaded ||
                        browserLocalStatusById[model.id]?.partial ||
                        browserLocalDownloadStateById[model.id]?.loading
                      "
                      sm
                      :disabled="
                        browserLocalDownloadStateById[model.id]?.loading
                      "
                      @click="downloadBrowserLlmModel(model.id)"
                    >
                      {{
                        browserLocalStatusById[model.id]?.partial
                          ? t('settings.browserLocalLlmResume')
                          : t('settings.browserLocalLlmDownload')
                      }}
                    </Button>
                    <span v-else class="text-success flex items-center">
                      {{ t('settings.browserLocalLlmReady') }}
                    </span>
                    <Button
                      v-if="
                        (browserLocalStatusById[model.id]?.downloaded ||
                          browserLocalStatusById[model.id]?.partial) &&
                        !browserLocalDownloadStateById[model.id]?.loading
                      "
                      sm
                      neutral
                      @click="deleteBrowserLlmModel(model.id)"
                    >
                      {{ t('settings.browserLocalLlmDelete') }}
                    </Button>
                  </div>
                </div>
                <div class="text-xs text-muted whitespace-pre-wrap">
                  {{ t('settings.browserLocalLlmHint') }}
                </div>
              </template>

              <template v-else-if="model.provider === 'ollama'">
                <FieldRow :label="t('settings.baseUrl')" vertical>
                  <FieldInput
                    :value="model.baseUrl || 'http://localhost:11434'"
                    placeholder="http://localhost:11434"
                    @update:value="setOllamaBaseUrl(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.ollamaModel')" vertical>
                  <FieldInput
                    :value="model.model || DEFAULT_OLLAMA_MODEL"
                    placeholder="qwen2.5:0.5b"
                    @update:value="setOllamaModel(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.temperature')" vertical>
                  <FieldInput
                    :value="String(model.temperature ?? 0.2)"
                    @update:value="setOllamaTemperature(model.id, $event)"
                  />
                </FieldRow>
                <FieldRow :label="t('settings.maxTokens')" vertical>
                  <FieldInput
                    :value="String(model.maxTokens ?? 512)"
                    @update:value="setOllamaMaxTokens(model.id, $event)"
                  />
                </FieldRow>
                <div class="text-xs text-muted whitespace-pre-wrap">
                  {{ t('settings.ollamaHint') }}
                </div>
              </template>
              <template v-else>
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
                <div class="text-xs text-muted whitespace-pre-wrap">
                  {{ t('settings.openAiCompatibleHint') }}
                </div>
              </template>
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

      <div v-show="currentTab === 4">
        <h2>{{ t('settings.aiRules') }}</h2>
        <FieldRow :label="t('settings.baseRules')">
          <FieldTextArea v-model:value="userConfig.aiRules.base" />
        </FieldRow>
        <FieldRow :label="t('settings.quickTranslation')">
          <FieldTextArea v-model:value="userConfig.aiRules.translate" />
        </FieldRow>
        <FieldRow :label="t('settings.voiceCorrectionRules')">
          <FieldTextArea v-model:value="userConfig.aiRules.voiceCorrection" />
        </FieldRow>
        <FieldRow :label="t('settings.textCorrection')">
          <FieldTextArea v-model:value="userConfig.aiRules.correction" />
        </FieldRow>
      </div>

      <div v-show="currentTab === 5">
        <FieldRow :label="t('settings.aiTasks')">
          <FieldItems :items="userConfig.aiTasks" @update:items="updateAiTasks">
            <template #item="{ item, index }">
              <div class="flex flex-row gap-2 w-full">
                <div>
                  <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
                </div>
                <div class="flex-1">
                  <FieldRow :label="t('settings.name')" vertical>
                    <FieldInput v-model:value="item.name" />
                  </FieldRow>
                  <FieldRow :label="t('settings.rule')" vertical>
                    <FieldTextArea v-model:value="item.rule" />
                  </FieldRow>
                </div>
              </div>
            </template>
          </FieldItems>
        </FieldRow>
      </div>

      <div v-show="currentTab === 6">
        <FieldRow :label="t('settings.chatRoles')">
          <FieldItems
            :items="userConfig.chatRoles"
            @update:items="updateChatRoles"
          >
            <template #item="{ item, index }">
              <div class="flex flex-row gap-2 w-full">
                <div>
                  <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
                </div>
                <div class="flex-1">
                  <FieldRow :label="t('settings.name')" vertical>
                    <FieldInput v-model:value="item.name" />
                  </FieldRow>
                  <FieldRow :label="t('settings.rule')" vertical>
                    <FieldTextArea v-model:value="item.rule" />
                  </FieldRow>
                </div>
              </div>
            </template>
          </FieldItems>
        </FieldRow>
      </div>

      <div v-show="currentTab === 7">
        <template v-for="plugin of plugins" :key="plugin.pluginName">
          <h2>{{ plugin.labelKey ? t(plugin.labelKey) : plugin.label }}</h2>
          <FieldsByCfg
            :config="plugin.fields"
            @update:values="updatePluginConfig(plugin.pluginName, $event)"
          />
        </template>
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
import { pluginIndexes } from '../plugins'
import { useIpcStore } from '../stores/ipc'
import { useThemeStore } from '../stores/theme'
import { PRESETS_KEYS } from '../types'
import {
  BROWSER_LLM_MODELS,
  DEFAULT_BROWSER_LLM_MODEL,
  DEFAULT_OLLAMA_MODEL,
  type LlmModelDownloadProgress,
  deleteLlmModel,
  downloadLlmModel,
  getLlmModelMetadata,
  hasPartialLlmModelDownload,
  isLlmModelDownloaded,
} from '../utils/llm/model-storage'
import {
  DEFAULT_WHISPER_LOCAL_MODEL,
  type ModelDownloadProgress,
  WHISPER_LOCAL_MODELS,
  deleteModel,
  downloadModel,
  getModelMetadata,
  hasPartialWhisperModelDownload,
  isModelDownloaded,
} from '../utils/stt/model-storage'
import {
  DEFAULT_USER_CONFIG,
  type LlmModelMetadata,
  type StorageInfo,
  type WhisperModelMetadata,
} from '@shared'

const ipcStore = useIpcStore()
const themeStore = useThemeStore()
const { t, locale } = useI18n()
const { toast } = useToast()

const SAVE_DEBOUNCE_MS = 500

type DownloadState = {
  loading: boolean
  progress: number
  file: string
  fileIndex: number
  fileCount: number
  status: string
  error: string
}

const pluginConfigs = pluginIndexes
  .map((pluginIndex) => pluginIndex())
  .filter((plugin) => plugin.defaultConfig)
  .map((plugin) => ({
    pluginName: plugin.name,
    labelKey: plugin.labelKey,
    label: plugin.label,
    fields: plugin.defaultConfig!.fields,
  }))

const currentTab = ref(0)
const currentSttProvider = ref<'vosk' | 'whisper-local'>('vosk')
const userConfig = ref(createPreparedUserConfig(ipcStore.params.userConfig))
const lastPersistedConfig = ref(serializeUserConfig(userConfig.value))
const isWhisperModelDownloaded = ref(false)
const isWhisperModelPartiallyDownloaded = ref(false)
const whisperModelMetadata = ref<WhisperModelMetadata | null>(null)
const browserLocalStatusById = ref<
  Record<
    string,
    {
      downloaded: boolean
      partial: boolean
      metadata: LlmModelMetadata | null
    }
  >
>({})
const storageInfo = ref<StorageInfo | null>(null)
const downloadState = ref<DownloadState>({
  loading: false,
  progress: 0,
  file: '',
  fileIndex: 0,
  fileCount: 0,
  status: '',
  error: '',
})
const browserLocalDownloadStateById = ref<Record<string, DownloadState>>({})
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
  { text: 'Whisper local', key: 'whisper-local' },
  { text: 'Vosk', key: 'vosk' },
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

    if (provider === 'whisper-local') {
      const whisperModel = ensureWhisperLocalModel(userConfig.value)
      userConfig.value.aiModelUsage.stt = whisperModel.id
      return
    }

    const voskModel = ensureVoskModel(userConfig.value)
    userConfig.value.aiModelUsage.stt = voskModel.id
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
    { label: t('settings.storageModels'), value: storageInfo.value.modelsDir },
    { label: t('settings.storageCache'), value: storageInfo.value.cacheDir },
  ]
})

const whisperModelDownloadedAt = computed(() => {
  const timestamp = Number(whisperModelMetadata.value?.downloadedAt || 0)

  if (!timestamp) {
    return ''
  }

  return new Date(timestamp * 1000).toLocaleString()
})

const plugins = computed(() => {
  return Object.keys(userConfig.value.plugins || {})
    .map((pluginName) => {
      const pluginCfg = pluginConfigs.find(
        (plugin: any) => plugin.pluginName === pluginName
      )

      if (!pluginCfg) {
        return null
      }

      const pluginValues = userConfig.value.plugins?.[pluginName] || {}

      return {
        ...pluginCfg,
        fields: pluginCfg.fields.map((field: any) => ({
          ...field,
          value: pluginValues[field.name],
        })),
      }
    })
    .filter((plugin) => plugin !== null)
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

  for (const pluginCfg of pluginConfigs) {
    if (!config.plugins[pluginCfg.pluginName]) {
      config.plugins[pluginCfg.pluginName] = {}
    }

    for (const field of pluginCfg.fields) {
      if (config.plugins[pluginCfg.pluginName][field.name] === undefined) {
        config.plugins[pluginCfg.pluginName][field.name] = field.defaultValue
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

  const existingWhisperModel = config.sttModels.filter(
    (model: Record<string, any>) => {
      const provider = model.provider || model.model
      return provider === 'whisper-local'
    }
  )[0]
  const existingVoskModel = config.sttModels.find(
    (model: Record<string, any>) => {
      const provider = model.provider || model.model || 'vosk'
      return provider !== 'whisper-local'
    }
  )
  const whisperModel = createWhisperLocalModel(existingWhisperModel)
  const voskModel = createVoskModel(existingVoskModel)
  const activeModel = config.sttModels.find(
    (model: Record<string, any>) => model.id === config.aiModelUsage.stt
  )
  const activeProvider = activeModel?.provider || activeModel?.model

  config.sttModels = [whisperModel, voskModel]
  config.aiModelUsage.stt =
    activeProvider === 'whisper-local' ? whisperModel.id : voskModel.id
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
    dedupedModels.length > 0 ? dedupedModels : [createBrowserLocalLlmModel()]

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

function createWhisperLocalModel(existingModel?: Record<string, any>) {
  return {
    id: existingModel?.id || 'browser-whisper-local',
    model: 'whisper-local',
    provider: 'whisper-local',
    description:
      existingModel?.description || t('settings.whisperLocalDescription'),
    formatWithLlm: existingModel?.formatWithLlm ?? false,
    restorePunctuation: true,
    localModel: existingModel?.localModel || DEFAULT_WHISPER_LOCAL_MODEL,
  }
}

function createVoskModel(existingModel?: Record<string, any>) {
  return {
    id: 'system-vosk',
    model: 'vosk',
    provider: 'vosk',
    description:
      existingModel?.description || t('settings.systemVoskDescription'),
    formatWithLlm: existingModel?.formatWithLlm !== false,
    baseUrl: existingModel?.baseUrl || 'ws://localhost:2700',
  }
}

function createBrowserLocalLlmModel(existingModel?: Record<string, any>) {
  return {
    id: existingModel?.id || createLlmModelId('browser-local'),
    name:
      existingModel?.name ||
      existingModel?.label ||
      t('settings.browserLocalModelDefaultName'),
    model: 'browser-local',
    provider: 'browser-local',
    description:
      existingModel?.description || t('settings.browserLocalLlmDescription'),
    localModel: existingModel?.localModel || DEFAULT_BROWSER_LLM_MODEL,
    temperature: toNumberOrDefault(existingModel?.temperature, 0.2),
    maxTokens: toIntegerOrDefault(existingModel?.maxTokens, 256),
  }
}

function createOllamaModel(existingModel?: Record<string, any>) {
  return {
    id: existingModel?.id || createLlmModelId('ollama'),
    name:
      existingModel?.name ||
      existingModel?.label ||
      t('settings.ollamaModelDefaultName'),
    model: existingModel?.model || DEFAULT_OLLAMA_MODEL,
    provider: 'ollama',
    description: existingModel?.description || t('settings.ollamaDescription'),
    baseUrl: existingModel?.baseUrl || 'http://localhost:11434',
    temperature: toNumberOrDefault(existingModel?.temperature, 0.2),
    maxTokens: toIntegerOrDefault(existingModel?.maxTokens, 512),
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
  }
}

function ensureWhisperLocalModel(config: Record<string, any>) {
  const existingModel = (config.sttModels || []).find(
    (model: Record<string, any>) => model.provider === 'whisper-local'
  )
  const nextModel = createWhisperLocalModel(existingModel)
  const otherModels = (config.sttModels || []).filter(
    (model: Record<string, any>) => model.provider !== 'whisper-local'
  )

  config.sttModels = [nextModel, ...otherModels]
  return nextModel
}

function ensureVoskModel(config: Record<string, any>) {
  const existingModel = (config.sttModels || []).find(
    (model: Record<string, any>) => model.provider === 'vosk'
  )
  const nextModel = createVoskModel(existingModel)
  const otherModels = (config.sttModels || []).filter(
    (model: Record<string, any>) => model.provider !== 'vosk'
  )

  config.sttModels = [...otherModels, nextModel]
  return nextModel
}

function resolveCurrentSttProvider(config: Record<string, any>) {
  const usageId = config.aiModelUsage?.stt
  const model = (config.sttModels || []).find(
    (item: Record<string, any>) => item.id === usageId
  )

  return model?.provider === 'whisper-local' ? 'whisper-local' : 'vosk'
}

function normalizeSingleLlmModel(model: Record<string, any>) {
  const provider = model.provider || model.model

  if (provider === 'browser-local') {
    return createBrowserLocalLlmModel(model)
  }

  if (provider === 'ollama') {
    return createOllamaModel(model)
  }

  if (provider === 'openai-compatible') {
    return createOpenAiCompatibleModel(model)
  }

  if (provider) {
    return createOpenAiCompatibleModel({
      ...model,
      provider: 'openai-compatible',
    })
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
    return {
      ...model,
      id: nextId,
    }
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

const translateLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions(
    userConfig.value.toTranslateLanguages || [],
    false,
    t
  )
})

watch(
  () => [userConfig.value.appLanguage, userConfig.value.userLanguage],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  }
)

const translateLanguagesItems = computed(() => {
  return (userConfig.value.toTranslateLanguages || []).map((lang: string) => ({
    value: lang,
  }))
})

const voskWsUrl = computed(() => {
  const voskModel = (userConfig.value.sttModels || []).find(
    (model: Record<string, any>) => model.provider === 'vosk'
  )

  return voskModel?.baseUrl || 'ws://localhost:2700'
})

const whisperLocalConfig = computed(() => {
  return (
    (userConfig.value.sttModels || []).find(
      (model: Record<string, any>) => model.provider === 'whisper-local'
    ) || createWhisperLocalModel()
  )
})

const voskConfig = computed(() => {
  return (
    (userConfig.value.sttModels || []).find(
      (model: Record<string, any>) => model.provider === 'vosk'
    ) || createVoskModel()
  )
})

const whisperLocalModel = computed(() => {
  return whisperLocalConfig.value.localModel || DEFAULT_WHISPER_LOCAL_MODEL
})

const llmUsageOptions = computed(() => {
  return (userConfig.value.llmModels || []).map(
    (model: Record<string, any>, index: number) => ({
      id: model.id,
      name:
        model.provider === 'browser-local' &&
        !browserLocalStatusById.value[model.id]?.downloaded
          ? `${modelDisplayName(model, index)} (${t('settings.downloadRequired')})`
          : modelDisplayName(model, index),
    })
  )
})

watch(
  whisperLocalModel,
  () => {
    void refreshWhisperModelStatus()
  },
  { immediate: true }
)

watch(
  () =>
    userConfig.value.llmModels
      .filter(
        (model: Record<string, any>) => model.provider === 'browser-local'
      )
      .map(
        (model: Record<string, any>) =>
          `${model.id}:${model.localModel || DEFAULT_BROWSER_LLM_MODEL}`
      ),
  () => {
    void refreshAllBrowserLlmStatuses()
  },
  { immediate: true, deep: true }
)

const updateTranslateLanguages = (items: Record<string, any>[]) => {
  userConfig.value.toTranslateLanguages = items.map(
    (item: Record<string, any>) => item.value
  )
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

const setVoskWsUrl = (baseUrl: string) => {
  const whisperModel = ensureWhisperLocalModel(userConfig.value)
  const nextVoskModel = {
    id: 'system-vosk',
    model: 'vosk',
    provider: 'vosk',
    description: t('settings.systemVoskDescription'),
    baseUrl: baseUrl || 'ws://localhost:2700',
  }

  userConfig.value.sttModels = [whisperModel, nextVoskModel]
  userConfig.value.aiModelUsage.stt = nextVoskModel.id
}

const setWhisperLocalModel = (modelName: string | number | undefined) => {
  if (typeof modelName !== 'string') {
    return
  }

  const whisperModel = ensureWhisperLocalModel(userConfig.value)
  whisperModel.localModel = modelName
  userConfig.value.aiModelUsage.stt = whisperModel.id
}

const setWhisperFormatWithLlm = (value: boolean) => {
  const whisperModel = ensureWhisperLocalModel(userConfig.value)
  whisperModel.formatWithLlm = value
}

const setVoskFormatWithLlm = (value: boolean) => {
  const voskModel = ensureVoskModel(userConfig.value)
  voskModel.formatWithLlm = value
}

function modelDisplayName(model: Record<string, any>, index: number | string) {
  const customName = String(model.name || '').trim()
  const displayIndex = Number(index) + 1

  if (customName) {
    return customName
  }

  if (model.provider === 'ollama') {
    return `${t('settings.ollama')} ${displayIndex}`
  }

  if (model.provider === 'openai-compatible') {
    return `${t('settings.openAiCompatible')} ${displayIndex}`
  }

  return `${t('settings.browserLocalLlm')} ${displayIndex}`
}

function formatDownloadedAt(value?: string) {
  const timestamp = Number(value || 0)

  if (!timestamp) {
    return ''
  }

  return new Date(timestamp * 1000).toLocaleString()
}

function getLlmModelById(modelId: string) {
  return (userConfig.value.llmModels || []).find(
    (model: Record<string, any>) => model.id === modelId
  )
}

function getEmptyDownloadState(): DownloadState {
  return {
    loading: false,
    progress: 0,
    file: '',
    fileIndex: 0,
    fileCount: 0,
    status: '',
    error: '',
  }
}

function ensureBrowserLocalDownloadState(modelId: string) {
  if (!browserLocalDownloadStateById.value[modelId]) {
    browserLocalDownloadStateById.value[modelId] = getEmptyDownloadState()
  }

  return browserLocalDownloadStateById.value[modelId]
}

function setLlmModelName(modelId: string, value: string) {
  const model = getLlmModelById(modelId)

  if (!model) {
    return
  }

  model.name = value
}

function addBrowserLocalLlmModel() {
  userConfig.value.llmModels.push(createBrowserLocalLlmModel())
}

function addOllamaLlmModel() {
  userConfig.value.llmModels.push(createOllamaModel())
}

function addOpenAiCompatibleLlmModel() {
  userConfig.value.llmModels.push(createOpenAiCompatibleModel())
}

function removeLlmModel(modelId: string) {
  const nextModels = userConfig.value.llmModels.filter(
    (model: Record<string, any>) => model.id !== modelId
  )

  if (nextModels.length === 0) {
    nextModels.push(createBrowserLocalLlmModel())
  }

  userConfig.value.llmModels = nextModels
  delete browserLocalStatusById.value[modelId]
  delete browserLocalDownloadStateById.value[modelId]

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

const setBrowserLocalModel = (
  modelId: string,
  modelName: string | number | undefined
) => {
  if (typeof modelName !== 'string') {
    return
  }

  const browserLocalModel = getLlmModelById(modelId)

  if (!browserLocalModel) {
    return
  }

  browserLocalModel.localModel = modelName
}

const setBrowserLocalTemperature = (modelId: string, value: string) => {
  const browserLocalModel = getLlmModelById(modelId)

  if (!browserLocalModel) {
    return
  }

  browserLocalModel.temperature = toNumberOrDefault(value, 0.2)
}

const setBrowserLocalMaxTokens = (modelId: string, value: string) => {
  const browserLocalModel = getLlmModelById(modelId)

  if (!browserLocalModel) {
    return
  }

  browserLocalModel.maxTokens = toIntegerOrDefault(value, 256)
}

const setOllamaBaseUrl = (modelId: string, baseUrl: string) => {
  const ollamaModel = getLlmModelById(modelId)

  if (!ollamaModel) {
    return
  }

  ollamaModel.baseUrl = baseUrl || 'http://localhost:11434'
}

const setOllamaModel = (modelId: string, value: string) => {
  const ollamaModel = getLlmModelById(modelId)

  if (!ollamaModel) {
    return
  }

  ollamaModel.model = value || DEFAULT_OLLAMA_MODEL
}

const setOllamaTemperature = (modelId: string, value: string) => {
  const ollamaModel = getLlmModelById(modelId)

  if (!ollamaModel) {
    return
  }

  ollamaModel.temperature = toNumberOrDefault(value, 0.2)
}

const setOllamaMaxTokens = (modelId: string, value: string) => {
  const ollamaModel = getLlmModelById(modelId)

  if (!ollamaModel) {
    return
  }

  ollamaModel.maxTokens = toIntegerOrDefault(value, 512)
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

async function refreshWhisperModelStatus() {
  const [downloaded, partial, metadata] = await Promise.all([
    isModelDownloaded(whisperLocalModel.value),
    hasPartialWhisperModelDownload(whisperLocalModel.value),
    getModelMetadata(whisperLocalModel.value),
  ])
  isWhisperModelDownloaded.value = downloaded
  isWhisperModelPartiallyDownloaded.value = !downloaded && partial
  whisperModelMetadata.value = downloaded ? metadata : null
}

async function refreshBrowserLlmModelStatus(modelId: string) {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'browser-local') {
    delete browserLocalStatusById.value[modelId]
    return
  }

  const modelName = model.localModel || DEFAULT_BROWSER_LLM_MODEL
  const [downloaded, partial, metadata] = await Promise.all([
    isLlmModelDownloaded(modelName),
    hasPartialLlmModelDownload(modelName),
    getLlmModelMetadata(modelName),
  ])

  browserLocalStatusById.value[modelId] = {
    downloaded,
    partial: !downloaded && partial,
    metadata: downloaded ? metadata : null,
  }
}

async function refreshAllBrowserLlmStatuses() {
  const browserLocalIds = new Set(
    (userConfig.value.llmModels || [])
      .filter(
        (model: Record<string, any>) => model.provider === 'browser-local'
      )
      .map((model: Record<string, any>) => model.id)
  )

  await Promise.all(
    [...browserLocalIds].map((modelId) =>
      refreshBrowserLlmModelStatus(modelId as string)
    )
  )

  Object.keys(browserLocalStatusById.value).forEach((modelId) => {
    if (!browserLocalIds.has(modelId)) {
      delete browserLocalStatusById.value[modelId]
      delete browserLocalDownloadStateById.value[modelId]
    }
  })
}

async function loadStorageInfo() {
  const result = await ipcStore.callFunction('getStorageInfo')
  storageInfo.value = result.success
    ? (result.result as StorageInfo | null) || null
    : null
}

async function downloadWhisperModel() {
  if (downloadState.value.loading) {
    return
  }

  downloadState.value = {
    loading: true,
    progress: 0,
    file: '',
    fileIndex: 0,
    fileCount: 0,
    status: '',
    error: '',
  }

  try {
    await downloadModel(
      whisperLocalModel.value,
      (progress: ModelDownloadProgress) => {
        downloadState.value = {
          loading: true,
          progress:
            progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0,
          file: progress.file,
          fileIndex: 0,
          fileCount: 0,
          status: progress.status,
          error: '',
        }
      }
    )
    await refreshWhisperModelStatus()
  } catch (error) {
    downloadState.value = {
      loading: false,
      progress: 0,
      file: '',
      fileIndex: 0,
      fileCount: 0,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
    return
  } finally {
    if (downloadState.value.status !== 'error') {
      downloadState.value = {
        loading: false,
        progress: 0,
        file: '',
        fileIndex: 0,
        fileCount: 0,
        status: '',
        error: '',
      }
    }
  }
}

async function deleteWhisperModel() {
  downloadState.value = {
    loading: false,
    progress: 0,
    file: '',
    fileIndex: 0,
    fileCount: 0,
    status: '',
    error: '',
  }

  try {
    await deleteModel(whisperLocalModel.value)
    await refreshWhisperModelStatus()
  } catch (error) {
    downloadState.value = {
      loading: false,
      progress: 0,
      file: '',
      fileIndex: 0,
      fileCount: 0,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function downloadBrowserLlmModel(modelId: string) {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'browser-local') {
    return
  }

  const modelName = model.localModel || DEFAULT_BROWSER_LLM_MODEL
  const currentState = ensureBrowserLocalDownloadState(modelId)

  if (currentState.loading) {
    return
  }

  browserLocalDownloadStateById.value[modelId] = {
    loading: true,
    progress: 0,
    file: '',
    fileIndex: 0,
    fileCount: 0,
    status: '',
    error: '',
  }

  try {
    await downloadLlmModel(modelName, (progress: LlmModelDownloadProgress) => {
      browserLocalDownloadStateById.value[modelId] = {
        loading: true,
        progress: progress.overallProgress,
        file: progress.file,
        fileIndex: progress.fileIndex,
        fileCount: progress.fileCount,
        status: progress.status,
        error: '',
      }
    })
    await refreshAllBrowserLlmStatuses()
  } catch (error) {
    browserLocalDownloadStateById.value[modelId] = {
      loading: false,
      progress: 0,
      file: '',
      fileIndex: 0,
      fileCount: 0,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
    return
  } finally {
    if (browserLocalDownloadStateById.value[modelId]?.status !== 'error') {
      browserLocalDownloadStateById.value[modelId] = {
        loading: false,
        progress: 0,
        file: '',
        fileIndex: 0,
        fileCount: 0,
        status: '',
        error: '',
      }
    }
  }
}

async function deleteBrowserLlmModel(modelId: string) {
  const model = getLlmModelById(modelId)

  if (!model || model.provider !== 'browser-local') {
    return
  }

  const modelName = model.localModel || DEFAULT_BROWSER_LLM_MODEL
  browserLocalDownloadStateById.value[modelId] = getEmptyDownloadState()

  try {
    await deleteLlmModel(modelName)
    await refreshAllBrowserLlmStatuses()
  } catch (error) {
    browserLocalDownloadStateById.value[modelId] = {
      loading: false,
      progress: 0,
      file: '',
      fileIndex: 0,
      fileCount: 0,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const updateAiTasks = (items: any[]) => {
  userConfig.value.aiTasks = items
}

const updateChatRoles = (items: any[]) => {
  userConfig.value.chatRoles = items
}

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, any>
) => {
  userConfig.value.plugins[pluginName] = values
}
onMounted(() => {
  void loadStorageInfo()
  void refreshAllBrowserLlmStatuses()
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
