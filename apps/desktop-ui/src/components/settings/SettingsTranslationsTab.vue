<template>
  <div class="flex flex-col gap-6">
    <SettingsSection>
      <template #description>
        <span>{{ t('settings.translationsPageHint') }}</span
        >{{ ' ' }}
        <InlineAction @click="emit('navigate', 'languages')">
          {{ t('settings.languagesTab') }}</InlineAction
        >.
      </template>

      <FieldRow :label="t('settings.translationProvider')">
        <FieldSelect
          class="w-full"
          :model-value="translation.provider"
          :options="providerOptions"
          @update:model-value="updateProvider"
        />
      </FieldRow>

      <FieldRow
        v-if="translation.provider !== 'llm'"
        :label="t('settings.apiKey')"
        vertical
      >
        <SecretKeyField
          :key="providerSecretId"
          v-model:model-value="keyDraft"
          :has-key="hasProviderKey"
          :save="saveProviderKey"
          :remove="removeProviderKey"
        />
        <SecretStorageNotice class="mt-2" />
      </FieldRow>

      <FieldRow
        :label="t('settings.translationCorrection')"
        :info="t('settings.translationCorrectionInfo')"
      >
        <div class="flex w-full flex-col items-start gap-2">
          <FieldSelect
            class="w-full"
            :model-value="translation.qualityGate"
            :options="qualityOptions"
            @update:model-value="updateQualityGate"
          />
          <Button
            v-if="translation.qualityGate === 'always' && !correctionPromptOpen"
            size="xs"
            variant="ghost"
            icon="mdi:plus"
            @click="correctionPromptOpen = true"
          >
            {{ t('settings.translationCorrectionPromptAdd') }}
          </Button>
        </div>
      </FieldRow>

      <FieldRow
        v-if="translation.qualityGate === 'always' && correctionPromptOpen"
        :label="t('settings.translationCorrectionPrompt')"
        :info="t('settings.translationCorrectionPromptInfo')"
        vertical
      >
        <FieldTextArea
          :model-value="translation.correctionPrompt"
          @update:model-value="updateCorrectionPrompt"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      v-if="usesTranslationRules"
      :title="t('settings.translationRules')"
      :info="t('settings.translationRulesInfo')"
    >
      <FieldTextArea v-model="userConfig.aiRules.translate" />
    </SettingsSection>

    <SettingsSection
      :title="t('settings.translationGlossary')"
      :info="t('settings.translationGlossaryInfo')"
      :description="glossaryHint"
    >
      <FieldTextArea
        :model-value="glossaryText"
        :placeholder="t('settings.translationGlossaryPlaceholder')"
        @update:model-value="updateGlossary"
      />
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { createTranslationSettingsModel } from '../../lib/translation/translation-settings-model'
import { useLlmStore } from '../../stores/llm'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from '../common/SettingsSection.vue'
import SecretKeyField from './SecretKeyField.vue'
import SecretStorageNotice from './SecretStorageNotice.vue'
import type { UserConfig } from '@tyco/shared'

const props = defineProps<{
  userConfig: Pick<UserConfig, 'translation' | 'aiRules'>
}>()

const emit = defineEmits<{ (e: 'navigate', tab: string): void }>()

const { t } = useI18n()
const { toastText } = useToast()
const llmStore = useLlmStore()
const {
  translation,
  keyDraft,
  providerSecretId,
  hasProviderKey,
  glossaryText,
  usesTranslationRules,
  updateProvider,
  updateQualityGate,
  updateCorrectionPrompt,
  updateGlossary,
  saveProviderKey,
  removeProviderKey,
} = createTranslationSettingsModel({
  getConfig: () => props.userConfig.translation,
  setConfig: (config) => {
    props.userConfig.translation = config
  },
  hasSecret: (id) => Object.hasOwn(llmStore.secrets, id),
  setSecret: (id, value) => llmStore.setSecret(id, value),
  removeSecret: (id) => llmStore.removeSecret(id),
  notifyKeyError: (error) =>
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error'),
})
// An empty prompt starts collapsed each time the page opens.
const correctionPromptOpen = ref(
  Boolean(translation.value.correctionPrompt?.trim())
)
const providerOptions = computed(() => [
  { id: 'deepl', name: t('settings.translationProviderDeepl') },
  { id: 'google', name: t('settings.translationProviderGoogle') },
  { id: 'llm', name: t('settings.translationProviderLlm') },
])
const qualityOptions = computed(() => [
  { id: 'off', name: t('settings.translationCorrectionOff') },
  { id: 'onProblems', name: t('settings.translationCorrectionOnProblems') },
  { id: 'always', name: t('settings.translationCorrectionAlways') },
])
// Without the AI correction pass, `term = use` rules are only checked,
// never applied, by DeepL and Google.
const glossaryHint = computed(() =>
  translation.value.provider !== 'llm' &&
  translation.value.qualityGate === 'off'
    ? t('settings.translationGlossaryMachineHint')
    : ''
)
</script>
