<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1 class="menu-title">{{ t('menu.reviewResult') }}</h1>
    <div class="flex-1 min-h-0 relative">
      <TextPreview :text="props.text" class="absolute" />
    </div>

    <div
      v-if="props.translationMeta"
      class="rounded-box bg-base-200 px-3 py-2 text-sm"
    >
      <div>
        {{ t('menu.translationProviderResult') }}:
        {{ providerLabel }}
        <template v-if="props.translationMeta.model">
          · {{ props.translationMeta.model }}
        </template>
      </div>
      <div
        v-if="props.translationMeta.quality.repairFailed"
        class="text-warning"
      >
        {{ t('menu.translationQualityRepairFailed') }}
        <template v-if="problemCodes">: {{ problemCodes }}</template>
      </div>
      <div
        v-else-if="props.translationMeta.quality.remainingProblems.length"
        class="text-warning"
      >
        {{ t('menu.translationQualityRemaining') }}:
        {{ problemCodes }}
      </div>
      <div v-else-if="props.translationMeta.quality.repaired" class="text-info">
        {{ t('menu.translationQualityRepaired') }}
      </div>
      <div
        v-else-if="props.translationMeta.quality.problems.length"
        class="text-warning"
      >
        {{ t('menu.translationQualityProblems') }}:
        {{ problemCodes }}
      </div>
      <div
        v-else-if="props.translationMeta.quality.gate !== 'off'"
        class="text-success"
      >
        {{ t('menu.translationQualityClean') }}
      </div>
    </div>

    <ShortcutList
      :text="props.text"
      :sourceText="props.sourceText"
      :leftLetterKeys="leftLetterKeys"
      :spaceKey="spaceKey"
      :toEditorVisible="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import type { TranslationQualityReport } from '@bozonx/ai-kit/translate'

const props = defineProps<{
  text: string
  sourceText?: string
  translationMeta?: {
    provider: string
    model?: string
    quality: TranslationQualityReport
  }
}>()

const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const { t } = useI18n()
const providerLabel = computed(() => {
  const providerKeys: Record<string, string> = {
    deepl: 'settings.translationProviderDeepl',
    google: 'settings.translationProviderGoogle',
    'google-translate': 'settings.translationProviderGoogle',
    llm: 'settings.translationProviderLlm',
  }
  const key = providerKeys[props.translationMeta?.provider || '']
  return key ? t(key) : props.translationMeta?.provider
})
const problemCodes = computed(() => {
  const quality = props.translationMeta?.quality
  const problems = quality?.remainingProblems.length
    ? quality.remainingProblems
    : (quality?.problems ?? [])
  return problems
    .map((problem) => t(`translationProblems.${problem.code}`))
    .join(', ')
})
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const leftLetterKeys = computed(
  () =>
    [
      ipcStore.params?.windowId ? defaultActions.value[0] : undefined,
      defaultActions.value[1],
    ].filter(Boolean) as ActionItem[]
)

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
)
</script>
