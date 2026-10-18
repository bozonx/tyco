<template>
  <ActionOverlayLayout :title="t('menu.reviewResult')" escMode="back">
    <template #header-extra>
      <div class="translation-header-tools">
        <ResultViewModeToggle
          preset="parallel"
          v-if="props.sourceText"
          v-model="viewMode"
        />
        <div v-if="props.translationMeta" class="translation-provider-badge">
          <Icon icon="mdi:translate" height="14" class="opacity-70" />
          <span>{{ providerLabel }}</span>
          <span v-if="props.translationMeta.model" class="opacity-70">
            · {{ props.translationMeta.model }}
          </span>
        </div>
      </div>
    </template>

    <template #preview>
      <div class="preview-menu-content">
        <InlineNotice
          v-if="qualityStatusText"
          class="translation-quality-alert"
          :kind="qualityStatusKind"
          :message="qualityStatusText"
        />
        <div class="flex-1 min-h-0">
          <ParallelTextPreview
            v-if="viewMode === 'split' && props.sourceText"
            :left-text="props.sourceText"
            :right-text="currentText"
            @update:right-text="currentText = $event"
          />
          <TextPreview v-else :text="currentText" />
        </div>
      </div>
    </template>

    <template #actions>
      <ShortcutList
        :text="currentText"
        :sourceText="props.sourceText"
        :leftLetterKeys="leftLetterKeys"
        :spaceKey="spaceKey"
        :isEditorButtonVisible="true"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePersistedTranslationViewMode } from '../../composables/use-persisted-view-mode'
import { usePreviewModeShortcut } from '../../composables/use-preview-mode-shortcut'
import { useResultActions } from '../../composables/use-result-actions'
import type { PreviewMenuParams } from '../../lib/modals/menu-modal-params'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Icon from '../common/AppIcon.vue'
import InlineNotice from '../common/InlineNotice.vue'
import ParallelTextPreview from '../common/ParallelTextPreview.vue'
import ResultViewModeToggle from '../common/ResultViewModeToggle.vue'
import TextPreview from '../common/TextPreview.vue'

const props = defineProps<PreviewMenuParams>()

const currentText = ref(props.text)
watch(
  () => props.text,
  (newText) => {
    currentText.value = newText
  }
)

const { viewMode, cycleMode } = usePersistedTranslationViewMode(() =>
  Boolean(props.sourceText)
)

usePreviewModeShortcut(cycleMode)

const { t } = useI18n()

const providerLabel = computed(() => {
  if (props.translationMeta?.kind === 'llm') {
    return t('settings.translationProviderLlm')
  }
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

const qualityStatusText = computed(() => {
  const quality = props.translationMeta?.quality
  if (!quality) return ''
  if (quality.repairFailed) {
    return problemCodes.value
      ? `${t('menu.translationQualityRepairFailed')}: ${problemCodes.value}`
      : t('menu.translationQualityRepairFailed')
  }
  if (quality.remainingProblems.length) {
    return `${t('menu.translationQualityRemaining')}: ${problemCodes.value}`
  }
  if (quality.repaired) {
    return t('menu.translationQualityRepaired')
  }
  if (quality.problems.length) {
    return `${t('menu.translationQualityProblems')}: ${problemCodes.value}`
  }
  return ''
})

const qualityStatusKind = computed<'info' | 'warning' | 'success'>(() => {
  const quality = props.translationMeta?.quality
  if (!quality) return 'info'
  if (
    quality.repairFailed ||
    quality.remainingProblems.length ||
    quality.problems.length
  ) {
    return 'warning'
  }
  if (quality.repaired) {
    return 'info'
  }
  return 'success'
})

const { leftLetterKeys, spaceKey } = useResultActions()
</script>

<style scoped>
.preview-menu-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.translation-header-tools {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.translation-provider-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.translation-quality-alert {
  padding: var(--space-xs) var(--space-md);
  font-size: var(--text-control);
  border-bottom: 1px solid var(--app-border-subtle);
}
</style>
