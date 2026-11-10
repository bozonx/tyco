<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.sttTab')"
      :info="t('settings.sttTabInfo')"
    >
      <FieldRow :label="t('settings.sttProvider')">
        <FieldSelect
          :model-value="userConfig.stt.provider"
          :options="sttProviderOptions"
          @update:model-value="setSttProvider"
        />
      </FieldRow>
      <FieldRow
        v-if="!sttNeedsKey"
        :label="t('settings.sttServerUrl')"
        :hint="t('settings.sttServerUrlHint')"
        :error="sttServerUrlError"
      >
        <template #info><DeviceScopeBadge /></template>
        <FieldInput
          :model-value="userConfig.stt.providers.sherpaOnnx.baseUrl"
          placeholder="ws://localhost:6006"
          @update:model-value="setSttServerUrl"
        />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.provider === 'deepgram'"
        :label="t('settings.model')"
      >
        <FieldInput
          :model-value="userConfig.stt.providers.deepgram.modelId"
          placeholder="nova-3"
          @update:model-value="setSttModelName"
        />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.provider === 'deepgram'"
        :label="t('settings.sttLanguage')"
        :info="t('settings.sttLanguageHint')"
      >
        <FieldSelect
          :model-value="
            userConfig.stt.providers.deepgram.language === 'multi'
              ? DICTATION_LANGUAGE_AUTO
              : userConfig.stt.providers.deepgram.language ||
                DICTATION_LANGUAGE_AUTO
          "
          :options="sttLanguageOptions"
          @update:model-value="setSttLanguage"
        />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.provider === 'geminiLive'"
        :label="t('settings.model')"
      >
        <FieldInput
          :model-value="
            userConfig.stt.providers.geminiLive?.modelId ??
            'gemini-3.5-transcribe-live'
          "
          placeholder="gemini-3.5-transcribe-live"
          @update:model-value="setGeminiLiveModelName"
        />
      </FieldRow>
      <FieldRow v-if="sttNeedsKey" :label="t('settings.apiKey')">
        <SecretKeyField
          :key="secretId(currentSttModel)"
          v-model:model-value="sttKeyDraft"
          :has-key="hasSttKey"
          :save="saveSttKey"
          :remove="removeSttKey"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.sttDictationSection')"
      :info="t('settings.sttDictationSectionInfo')"
    >
      <FieldRow
        :label="t('settings.microphoneLabel')"
        :info="t('settings.microphoneHint')"
        :warning="microphoneWarning"
        :error="micTestError"
      >
        <template #info><DeviceScopeBadge /></template>
        <div class="mic-picker">
          <div class="mic-picker-row">
            <FieldSelect
              class="mic-select"
              :model-value="selectedMicrophoneId"
              :options="microphoneOptions"
              @update:model-value="setMicrophoneId"
            />
            <IconButton
              size="sm"
              variant="ghost"
              icon="mdi:refresh"
              :disabled="isLoadingDevices"
              :label="t('settings.refreshMicrophones')"
              :title="t('settings.refreshMicrophones')"
              @click="void refreshInputDevices()"
            />
            <Button
              size="sm"
              :variant="isTestingMic ? 'primary' : 'ghost'"
              :icon="isTestingMic ? 'mdi:stop' : 'mdi:microphone'"
              @click="void toggleMicTest()"
            >
              {{
                isTestingMic
                  ? t('settings.stopMicTest')
                  : t('settings.testMicrophone')
              }}
            </Button>
          </div>
          <div
            v-if="isTestingMic"
            class="mic-meter"
            role="meter"
            :aria-label="t('settings.microphoneLevel')"
            :aria-valuemin="0"
            :aria-valuemax="100"
            :aria-valuenow="micMeterPercent"
          >
            <div class="mic-meter-track">
              <div
                class="mic-meter-fill"
                :style="{ width: `${micMeterPercent}%` }"
              />
            </div>
            <span class="mic-meter-hint">{{
              t('settings.microphoneTestHint')
            }}</span>
          </div>
        </div>
      </FieldRow>
      <FieldRow :label="t('settings.voiceTextCorrection')">
        <FieldSelect
          :model-value="userConfig.stt.correctionMode"
          :options="voiceCorrectionOptions"
          @update:model-value="setVoiceCorrectionMode"
        />
      </FieldRow>
      <SettingsTaskModel
        v-if="userConfig.stt.correctionMode !== 'off'"
        task="voiceCorrection"
      />
      <FieldRow
        v-if="userConfig.stt.correctionMode !== 'off'"
        :label="t('settings.sttLlmRules')"
        :info="t('settings.sttLlmRulesInfo')"
        vertical
      >
        <FieldPromptTextArea
          v-model="userConfig.llm.tasks.voiceCorrection.rule"
          :modal-title="t('settings.sttLlmRules')"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.showStylingBar')"
        :info="t('settings.showStylingBarHint')"
      >
        <FieldSwitch v-model="userConfig.stt.isStylingBarEnabled" />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.isStylingBarEnabled"
        class="styling-bar-nested"
        nested
        :separator="false"
        :label="t('settings.stylingBarDirectInsert')"
        :info="t('settings.stylingBarDirectInsertHint')"
      >
        <FieldSwitch v-model="userConfig.stt.isStylingBarDirectInsertEnabled" />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.sttListenSection')"
      :info="t('settings.sttListenSectionInfo')"
    >
      <ListenSourceField :nested="false" :separator="true" show-device-scope />
      <FieldRow :label="t('settings.listenHotkeyLabel')" :separator="false">
        <InlineAction @click="navigate('global-actions#hotkey-listen')">
          {{ t('settings.configureInHotkeys') }}
        </InlineAction>
      </FieldRow>
    </SettingsSection>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { useVoiceRecordingMeter } from '../../composables/use-voice-recording-meter'
import {
  COMMON_LANGUAGE_OPTIONS,
  buildLanguageOptions,
} from '../../lib/locale/language'
import { tauriNetIpc } from '../../lib/net/tauri-net'
import { createSecretKeyEditor } from '../../lib/settings/secret-key-editor'
import { DICTATION_LANGUAGE_AUTO } from '../../lib/stt/dictation-language'
import {
  buildMicrophoneOptions,
  createMicrophoneTester,
  listInputDevices,
} from '../../lib/stt/input-devices'
import {
  isKeyRequiredForSttProvider,
  isSttServerUrlValid,
  secretId,
} from '../../lib/stt/stt-client'
import { activeSttModel } from '../../lib/stt/stt-config'
import type { ControlOption } from '../../lib/ui/control-option'
import { useSecretsStore } from '../../stores/secrets'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InlineAction from '../common/InlineAction.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import ListenSourceField from './ListenSourceField.vue'
import SecretKeyField from './SecretKeyField.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import {
  type AudioInputDevice,
  STT_PROVIDERS,
  type SttProvider,
  VOICE_CORRECTION_MODES,
  type VoiceCorrectionMode,
} from '@tyco/shared'

const { draft: userConfig, navigate } = useSettingsContext()
const { t } = useI18n()
const secretsStore = useSecretsStore()
const { toastError } = useToast()
const sttKeyDraft = ref('')
const currentSttModel = computed(() => activeSttModel(userConfig.value.stt))

const inputDevices = ref<AudioInputDevice[]>([])
const isLoadingDevices = ref(false)
const hasLoadedDevices = ref(false)
const isTestingMic = ref(false)
const micTestError = ref<string>()
const { audioLevel, audioPeak } = useVoiceRecordingMeter(
  () => isTestingMic.value
)

const micMeterPercent = computed(() => {
  const signal = Math.max(audioLevel.value * 2.2, audioPeak.value * 0.9)
  return Math.min(100, Math.max(0, Math.round(signal * 100)))
})

const selectedMicrophoneId = computed(
  () => userConfig.value.stt.microphoneId?.trim() ?? ''
)

const microphoneOptions = computed(() =>
  buildMicrophoneOptions({
    devices: inputDevices.value,
    selectedId: selectedMicrophoneId.value,
    systemDefaultLabel: t('settings.microphoneSystemDefault'),
    defaultTagLabel: t('settings.microphoneDefaultTag'),
    unavailableTagLabel: t('settings.microphoneUnavailableTag'),
  })
)

const microphoneWarning = computed(() => {
  if (!hasLoadedDevices.value || !selectedMicrophoneId.value) return undefined
  if (
    inputDevices.value.some(
      (device) => device.id === selectedMicrophoneId.value
    )
  ) {
    return undefined
  }
  return t('settings.microphoneUnavailableHint')
})

const micTester = createMicrophoneTester({
  ipc: tauriNetIpc,
  onStopped: () => {
    isTestingMic.value = false
  },
  onError: (message) => {
    micTestError.value = message
    isTestingMic.value = false
  },
})

async function refreshInputDevices() {
  isLoadingDevices.value = true
  try {
    inputDevices.value = await listInputDevices(tauriNetIpc)
    hasLoadedDevices.value = true
  } catch {
    // Keep existing list if enumeration fails in a test/browser shell.
  } finally {
    isLoadingDevices.value = false
  }
}

async function startMicTest(deviceId = selectedMicrophoneId.value) {
  micTestError.value = undefined
  try {
    isTestingMic.value = true
    await micTester.start(deviceId || undefined)
  } catch (error) {
    isTestingMic.value = false
    micTestError.value = error instanceof Error ? error.message : String(error)
  }
}

async function stopMicTest() {
  isTestingMic.value = false
  await micTester.stop()
}

async function toggleMicTest() {
  if (isTestingMic.value) await stopMicTest()
  else await startMicTest()
}

function setMicrophoneId(value: string | number | undefined) {
  const next = String(value ?? '').trim()
  if (next) {
    userConfig.value.stt.microphoneId = next
  } else {
    delete userConfig.value.stt.microphoneId
  }
  if (isTestingMic.value) {
    void startMicTest(next)
  }
}

onMounted(() => {
  void refreshInputDevices()
})

onUnmounted(() => {
  void micTester.stop()
})

const sttNeedsKey = computed(() =>
  isKeyRequiredForSttProvider(currentSttModel.value.provider)
)

const sttProviderOptions = computed(() => [
  { id: 'deepgram', name: 'Deepgram' },
  { id: 'geminiLive', name: t('settings.sttProviderGeminiLive') },
  { id: 'sherpaOnnx', name: t('settings.sttProviderSherpaOnnx') },
])

const setSttProvider = (value: string | number | undefined) => {
  if (STT_PROVIDERS.includes(value as SttProvider))
    userConfig.value.stt.provider = value as SttProvider
}

const voiceCorrectionOptions = computed<ControlOption<VoiceCorrectionMode>[]>(
  () => [
    { id: 'live', name: t('settings.quickCorrectionLive') },
    { id: 'onSubmit', name: t('settings.quickCorrectionOnSubmit') },
    { id: 'off', name: t('settings.quickCorrectionOff') },
  ]
)

const setVoiceCorrectionMode = (value: string | number | undefined) => {
  if (
    typeof value === 'string' &&
    (VOICE_CORRECTION_MODES as readonly string[]).includes(value)
  ) {
    userConfig.value.stt.correctionMode = value as VoiceCorrectionMode
  }
}

/** Told here, not only when a dictation fails to start */
const sttServerUrlError = computed(() =>
  !sttNeedsKey.value &&
  !isSttServerUrlValid(userConfig.value.stt.providers.sherpaOnnx.baseUrl)
    ? t('settings.sttServerUrlInvalid')
    : undefined
)

const setSttServerUrl = (value: string) => {
  userConfig.value.stt.providers.sherpaOnnx.baseUrl = value.trim()
}

const setSttModelName = (value: string) => {
  userConfig.value.stt.providers.deepgram.modelId = value
}

const ensureGeminiLiveConfig = () => {
  if (!userConfig.value.stt.providers.geminiLive) {
    userConfig.value.stt.providers.geminiLive = {
      modelId: 'gemini-3.5-transcribe-live',
    }
  }
  return userConfig.value.stt.providers.geminiLive
}

const setGeminiLiveModelName = (value: string) => {
  ensureGeminiLiveConfig().modelId = value
}

const hasSttKey = computed(() =>
  Boolean(
    currentSttModel.value &&
    Object.hasOwn(secretsStore.secrets, secretId(currentSttModel.value))
  )
)

const keyEditor = createSecretKeyEditor({
  getSecretId: () =>
    sttNeedsKey.value ? secretId(currentSttModel.value) : undefined,
  getDraft: () => sttKeyDraft.value,
  setDraft: (value) => {
    sttKeyDraft.value = value
  },
  setSecret: secretsStore.setSecret,
  removeSecret: secretsStore.removeSecret,
  reportError: (error) => toastError(error, 'settings.keySaveFailed'),
})
const saveSttKey = () => keyEditor.save()
const removeSttKey = keyEditor.remove

const setSttLanguage = (value: string | number | undefined) => {
  userConfig.value.stt.providers.deepgram.language = String(
    value || DICTATION_LANGUAGE_AUTO
  )
}

const sttLanguageOptions = computed(() => {
  return [
    { id: DICTATION_LANGUAGE_AUTO, name: t('language.auto') },
    ...buildLanguageOptions([], false, t, COMMON_LANGUAGE_OPTIONS),
  ]
})

watch(
  () => secretId(currentSttModel.value),
  () => {
    sttKeyDraft.value = ''
  }
)
</script>

<style scoped>
.styling-bar-nested {
  background-color: var(--app-surface-sunken);
  border-left: 2px solid var(--app-border-strong);
  padding-top: var(--space-sm);
  padding-bottom: var(--space-sm);
}

.styling-bar-nested :deep(.field-row-title) {
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.mic-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
  min-width: 0;
}

.mic-picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.mic-select {
  flex: 1 1 14rem;
  min-width: 10rem;
}

.mic-meter {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs, 0.25rem);
}

.mic-meter-track {
  height: 0.375rem;
  width: 100%;
  border-radius: var(--radius-full, 9999px);
  background: var(--app-surface-sunken);
  overflow: hidden;
}

.mic-meter-fill {
  height: 100%;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-primary);
  transition: width 60ms linear;
}

.mic-meter-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
