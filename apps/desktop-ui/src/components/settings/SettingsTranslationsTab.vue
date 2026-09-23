<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.translationEngine')"
      :description="t('settings.translationEngineHint')"
    >
      <FieldRow :label="t('settings.translationProvider')">
        <FieldSelect
          class="w-full"
          :value="translation.provider"
          :options="providerOptions"
          @update:value="updateProvider"
        />
      </FieldRow>

      <FieldRow :label="t('settings.translationQuality')">
        <FieldSelect
          class="w-full"
          :value="translation.qualityGate"
          :options="qualityOptions"
          @update:value="updateQualityGate"
        />
      </FieldRow>

      <FieldRow
        v-if="translation.provider === 'deepl'"
        :label="t('settings.deeplPlan')"
      >
        <FieldSelect
          class="w-full"
          :value="translation.deeplEndpoint"
          :options="deeplEndpointOptions"
          @update:value="updateDeeplEndpoint"
        />
      </FieldRow>

      <FieldRow
        v-if="translation.provider !== 'llm'"
        :label="t('settings.apiKey')"
        vertical
      >
        <div class="flex gap-2">
          <FieldInput
            :value="keyDraft"
            type="password"
            :placeholder="
              hasProviderKey
                ? t('settings.apiKeyReplacePlaceholder')
                : t('settings.apiKeyPlaceholder')
            "
            @update:value="keyDraft = $event"
          />
          <button
            class="btn btn-primary"
            :disabled="!keyDraft.trim()"
            @click="saveProviderKey"
          >
            {{ t('common.save') }}
          </button>
          <button
            v-if="hasProviderKey"
            class="btn btn-ghost"
            @click="removeProviderKey"
          >
            {{ t('common.remove') }}
          </button>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection :description="t('settings.translationsHint')" bare>
      <ShortcutSlots
        :items="translateLanguageSlots"
        @move="moveLanguage"
        @add="addLanguage"
        @remove="removeLanguage"
      >
        <template #item="{ item, index }">
          <FieldSelect
            class="w-full"
            :value="item"
            :options="translateLanguageOptions"
            @update:value="updateLanguage(index, $event)"
          />
        </template>
      </ShortcutSlots>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.translationGlossary')"
      :description="t('settings.translationGlossaryHint')"
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

import { useI18n } from '../../composables/useI18n'
import {
  DEFAULT_LANGUAGE,
  buildLanguageOptions,
} from '../../lib/locale/language'
import {
  moveShortcutSlot,
  normalizeShortcutSlots,
} from '../../lib/shortcut-slots/shortcut-slots'
import { normalizeTranslationConfig } from '../../lib/translation/translation-config'
import { useLlmStore } from '../../stores/llm'
import FieldInput from '../common/FieldInput.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  (e: 'update:toTranslateLanguages', value: string[]): void
}>()

const { t, locale } = useI18n()
const llmStore = useLlmStore()
const keyDraft = ref('')
const translation = computed(() => props.userConfig.translation)
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
  { id: 'off', name: t('settings.translationQualityOff') },
  { id: 'on_problems', name: t('settings.translationQualityOnProblems') },
  { id: 'always', name: t('settings.translationQualityAlways') },
])
const deeplEndpointOptions = computed(() => [
  { id: 'free', name: t('settings.deeplPlanFree') },
  { id: 'pro', name: t('settings.deeplPlanPro') },
])

const glossaryText = computed(() =>
  translation.value.glossary
    .map((entry: { term: string; use: string; doNotTranslate: boolean }) =>
      entry.doNotTranslate ? `!${entry.term}` : `${entry.term} = ${entry.use}`
    )
    .join('\n')
)

const translateLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions(
    (props.userConfig.toTranslateLanguages || []).filter(Boolean),
    false,
    t
  )
})

const translateLanguageSlots = computed(() =>
  normalizeShortcutSlots<string>(props.userConfig.toTranslateLanguages)
)

function emitSlots(slots: (string | null)[]) {
  emit('update:toTranslateLanguages', slots as string[])
}

function moveLanguage(from: number, to: number) {
  emitSlots(moveShortcutSlot(translateLanguageSlots.value, from, to))
}

function addLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = DEFAULT_LANGUAGE
  emitSlots(slots)
}

function removeLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = null
  emitSlots(slots)
}

function updateLanguage(index: number, value: string | number | undefined) {
  if (typeof value !== 'string') return
  const slots = [...translateLanguageSlots.value]
  slots[index] = value
  emitSlots(slots)
}

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

function updateDeeplEndpoint(value: string | number | undefined) {
  props.userConfig.translation = normalizeTranslationConfig({
    ...translation.value,
    deeplEndpoint: value,
  })
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
  if (!keyDraft.value.trim()) return
  await llmStore.setSecret(providerSecretId.value, keyDraft.value.trim())
  keyDraft.value = ''
}

async function removeProviderKey() {
  await llmStore.removeSecret(providerSecretId.value)
}
</script>
