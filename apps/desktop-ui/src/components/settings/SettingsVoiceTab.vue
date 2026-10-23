<template>
  <div class="settings-stack">
    <SettingsSection>
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
      >
        <FieldInput
          :model-value="userConfig.stt.providers.sherpaOnnx.baseUrl"
          placeholder="ws://localhost:6006"
          @update:model-value="setSttServerUrl"
        />
      </FieldRow>
      <FieldRow v-if="sttNeedsKey" :label="t('settings.model')">
        <FieldInput
          :model-value="userConfig.stt.providers.deepgram.modelId"
          placeholder="nova-3"
          @update:model-value="setSttModelName"
        />
      </FieldRow>
      <FieldRow
        v-if="sttNeedsKey"
        :label="t('settings.sttLanguage')"
        :hint="t('settings.sttLanguageHint')"
      >
        <FieldSelect
          :model-value="
            userConfig.stt.providers.deepgram.language ||
            DICTATION_LANGUAGE_USER
          "
          :options="sttLanguageOptions"
          @update:model-value="setSttLanguage"
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

    <SettingsSection :title="t('settings.sttLlmFormatting')">
      <FieldRow :label="t('settings.formatWithLlm')">
        <FieldSwitch v-model="userConfig.stt.isVoiceCorrectionEnabled" />
      </FieldRow>
      <FieldRow
        v-if="userConfig.stt.isVoiceCorrectionEnabled"
        :label="t('settings.sttLlmRules')"
        vertical
      >
        <FieldTextArea v-model="userConfig.llm.tasks.voiceCorrection.rule" />
      </FieldRow>
    </SettingsSection>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { buildLanguageOptions } from '../../lib/locale/language'
import {
  DICTATION_LANGUAGE_MULTI,
  DICTATION_LANGUAGE_USER,
} from '../../lib/stt/dictation-language'
import { isKeyRequiredForSttProvider, secretId } from '../../lib/stt/stt-client'
import { activeSttModel } from '../../lib/stt/stt-config'
import { useSecretsStore } from '../../stores/secrets'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SecretKeyField from './SecretKeyField.vue'
import SettingsSection from './SettingsSection.vue'
import { STT_PROVIDERS, type SttProvider } from '@tyco/shared'

const { draft: userConfig } = useSettingsContext()
const { t } = useI18n()
const secretsStore = useSecretsStore()
const { toastText } = useToast()
const sttKeyDraft = ref('')
const currentSttModel = computed(() => activeSttModel(userConfig.value.stt))

const sttNeedsKey = computed(() =>
  isKeyRequiredForSttProvider(currentSttModel.value.provider)
)

const sttProviderOptions = computed(() => [
  { id: 'deepgram', name: 'Deepgram' },
  { id: 'sherpaOnnx', name: t('settings.sttProviderSherpaOnnx') },
])

const setSttProvider = (value: string | number | undefined) => {
  if (STT_PROVIDERS.includes(value as SttProvider))
    userConfig.value.stt.provider = value as SttProvider
}

const setSttServerUrl = (value: string) => {
  userConfig.value.stt.providers.sherpaOnnx.baseUrl = value.trim()
}

const setSttModelName = (value: string) => {
  userConfig.value.stt.providers.deepgram.modelId = value
}

const hasSttKey = computed(() =>
  Boolean(
    currentSttModel.value &&
    Object.hasOwn(secretsStore.secrets, secretId(currentSttModel.value))
  )
)

async function saveSttKey() {
  try {
    await secretsStore.setSecret(
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
    await secretsStore.removeSecret(secretId(currentSttModel.value))
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}

const setSttLanguage = (value: string | number | undefined) => {
  userConfig.value.stt.providers.deepgram.language = String(
    value || DICTATION_LANGUAGE_USER
  )
}

const sttLanguageOptions = computed(() => {
  return [
    { id: DICTATION_LANGUAGE_USER, name: t('settings.sttLanguageUser') },
    { id: DICTATION_LANGUAGE_MULTI, name: t('settings.sttLanguageMulti') },
    ...buildLanguageOptions([], false, t),
  ]
})

watch(
  () => secretId(currentSttModel.value),
  () => {
    sttKeyDraft.value = ''
  }
)
</script>
