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

    <SettingsSection>
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
        :hint="t('settings.showStylingBarHint')"
      >
        <FieldSwitch v-model="userConfig.stt.isStylingBarEnabled" />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.isStylingBarEnabled"
        :label="t('settings.stylingBarDirectInsert')"
        :hint="t('settings.stylingBarDirectInsertHint')"
      >
        <FieldSwitch v-model="userConfig.stt.isStylingBarDirectInsertEnabled" />
      </FieldRow>
    </SettingsSection>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  COMMON_LANGUAGE_OPTIONS,
  buildLanguageOptions,
} from '../../lib/locale/language'
import { createSecretKeyEditor } from '../../lib/settings/secret-key-editor'
import { DICTATION_LANGUAGE_AUTO } from '../../lib/stt/dictation-language'
import {
  isKeyRequiredForSttProvider,
  isSttServerUrlValid,
  secretId,
} from '../../lib/stt/stt-client'
import { activeSttModel } from '../../lib/stt/stt-config'
import { useSecretsStore } from '../../stores/secrets'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import SecretKeyField from './SecretKeyField.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import {
  STT_PROVIDERS,
  VOICE_CORRECTION_MODES,
  type SttProvider,
  type VoiceCorrectionMode,
} from '@tyco/shared'
import type { ControlOption } from '../../lib/ui/control-option'

const { draft: userConfig } = useSettingsContext()
const { t } = useI18n()
const secretsStore = useSecretsStore()
const { toastError } = useToast()
const sttKeyDraft = ref('')
const currentSttModel = computed(() => activeSttModel(userConfig.value.stt))

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
