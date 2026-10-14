<template>
  <div class="flex flex-col gap-6">
    <SettingsSection>
      <template #description>
        <span>{{ t('settings.translationsPageHint') }}</span
        >{{ ' ' }}
        <button
          type="button"
          class="settings-inline-link"
          @click="emit('navigate', 'languages')"
        >
          {{ t('settings.languagesTab') }}</button
        >.
      </template>

      <FieldRow :label="t('settings.translationProvider')">
        <FieldSelect
          class="w-full"
          :value="translation.provider"
          :options="providerOptions"
          @update:value="updateProvider"
        />
      </FieldRow>

      <FieldRow
        v-if="translation.provider !== 'llm'"
        :label="t('settings.apiKey')"
        vertical
      >
        <SecretKeyField
          :key="providerSecretId"
          v-model:value="keyDraft"
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
            :value="translation.qualityGate"
            :options="qualityOptions"
            @update:value="updateQualityGate"
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
          :value="translation.correctionPrompt"
          @update:value="updateCorrectionPrompt"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      v-if="usesTranslationRules"
      :title="t('settings.translationRules')"
      :info="t('settings.translationRulesInfo')"
    >
      <FieldTextArea v-model:value="userConfig.aiRules.translate" />
    </SettingsSection>

    <SettingsSection
      :title="t('settings.translationGlossary')"
      :info="t('settings.translationGlossaryInfo')"
      :description="glossaryHint"
    >
      <FieldTextArea
        :value="glossaryText"
        :placeholder="t('settings.translationGlossaryPlaceholder')"
        @update:value="updateGlossary"
      />
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { normalizeTranslationConfig } from '../../lib/translation/translation-config'
import { useLlmStore } from '../../stores/llm'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
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
const keyDraft = ref('')
const translation = computed(() => props.userConfig.translation)
// Not persisted: an empty prompt starts collapsed every time the page opens.
const correctionPromptOpen = ref(
  Boolean(props.userConfig.translation.correctionPrompt?.trim())
)
const providerSecretId = computed(() =>
  translation.value.provider === 'google' ? 'google-translate' : 'deepl'
)
const hasProviderKey = computed(() =>
  Object.hasOwn(llmStore.secrets, providerSecretId.value)
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
// DeepL and Google ignore the rules; only the AI correction pass reads them.
const usesTranslationRules = computed(
  () =>
    translation.value.provider === 'llm' ||
    translation.value.qualityGate !== 'off'
)
// Without the AI correction pass, `term = use` rules are only checked,
// never applied, by DeepL and Google.
const glossaryHint = computed(() =>
  translation.value.provider !== 'llm' &&
  translation.value.qualityGate === 'off'
    ? t('settings.translationGlossaryMachineHint')
    : ''
)

const glossaryText = computed(() =>
  translation.value.glossary
    .map((entry: { term: string; use: string; doNotTranslate: boolean }) =>
      entry.doNotTranslate ? `!${entry.term}` : `${entry.term} = ${entry.use}`
    )
    .join('\n')
)

function updateProvider(value: string | number | undefined) {
  props.userConfig.translation = normalizeTranslationConfig({
    ...translation.value,
    provider: value,
  })
  keyDraft.value = ''
}

function updateQualityGate(value: string | number | undefined) {
  props.userConfig.translation = normalizeTranslationConfig({
    ...translation.value,
    qualityGate: value,
  })
}

function updateCorrectionPrompt(value: string) {
  props.userConfig.translation.correctionPrompt = value
}

function updateGlossary(value: string) {
  const entries: { term: string; use: string; doNotTranslate: boolean }[] = []
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('!')) {
      const term = trimmed.slice(1).trim()
      if (term) entries.push({ term, use: term, doNotTranslate: true })
      continue
    }
    const [termPart, ...useParts] = trimmed.split('=')
    const term = termPart?.trim()
    const use = useParts.join('=').trim()
    if (term && use) entries.push({ term, use, doNotTranslate: false })
  }
  props.userConfig.translation.glossary = entries
}

async function saveProviderKey() {
  const trimmed = keyDraft.value.trim()
  if (!trimmed) return
  try {
    await llmStore.setSecret(providerSecretId.value, trimmed)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
    return
  }
  if (providerSecretId.value === 'deepl') {
    props.userConfig.translation = normalizeTranslationConfig({
      ...translation.value,
      deeplEndpoint: trimmed.endsWith(':fx') ? 'free' : 'pro',
    })
  }
  keyDraft.value = ''
}

async function removeProviderKey() {
  try {
    await llmStore.removeSecret(providerSecretId.value)
  } catch (error) {
    toastText(`${t('settings.keySaveFailed')}\n${String(error)}`, 'error')
  }
}
</script>

<style scoped>
.settings-inline-link {
  display: inline;
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 500;
}

.settings-inline-link:hover {
  filter: brightness(1.15);
}
</style>
