<template>
  <div class="settings-stack">
    <SettingsSection>
      <FieldRow :label="t('settings.sttProvider')">
        <FieldSelect
          :model-value="currentSttModel.provider"
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
          :model-value="currentSttModel.baseUrl || ''"
          placeholder="ws://localhost:6006"
          @update:model-value="setSttServerUrl"
        />
      </FieldRow>
      <FieldRow v-if="sttNeedsKey" :label="t('settings.model')">
        <FieldInput
          :model-value="currentSttModel.providerModelId || ''"
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
          :model-value="currentSttModel.language || DICTATION_LANGUAGE_USER"
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
        <FieldSwitch
          :key="currentSttModel.id"
          :model-value="Boolean(currentSttModel.formatWithLlm)"
          @update:model-value="setSttFormatWithLlm"
        />
      </FieldRow>
      <FieldRow
        v-if="Boolean(currentSttModel.formatWithLlm)"
        :label="t('settings.sttLlmRules')"
        vertical
      >
        <FieldTextArea v-model="userConfig.aiRules.voiceCorrection" />
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
import { secretId, sttProviderNeedsKey } from '../../lib/stt/stt-client'
import { activeSttModel, selectSttProvider } from '../../lib/stt/stt-config'
import { useSecretsStore } from '../../stores/secrets'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SecretKeyField from './SecretKeyField.vue'
import SettingsSection from './SettingsSection.vue'
import type { SttProvider } from '@tyco/shared'

const { draft: userConfig } = useSettingsContext()
const { t } = useI18n()
const secretsStore = useSecretsStore()
const { toastText } = useToast()
const sttKeyDraft = ref('')
const currentSttModel = computed(() => activeSttModel(userConfig.value.stt))

const sttNeedsKey = computed(() =>
  sttProviderNeedsKey(currentSttModel.value.provider)
)

const sttProviderOptions = computed(() => [
  { id: 'deepgram', name: 'Deepgram' },
  { id: 'sherpa-onnx', name: t('settings.sttProviderSherpaOnnx') },
])

const setSttProvider = (value: string | number | undefined) => {
  selectSttProvider(userConfig.value.stt, value as SttProvider)
}

const setSttServerUrl = (value: string) => {
  currentSttModel.value.baseUrl = value.trim()
}

const setSttModelName = (value: string) => {
  currentSttModel.value.providerModelId = value
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

const setSttFormatWithLlm = (value: boolean) => {
  currentSttModel.value.formatWithLlm = value
  for (const model of userConfig.value.stt.models ?? []) {
    model.formatWithLlm = value
  }
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

watch(
  () => secretId(currentSttModel.value),
  () => {
    sttKeyDraft.value = ''
  }
)
</script>
