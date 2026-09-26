<template>
  <ActionOverlayLayout :title="t('menu.reviewResult')">
    <template #header-extra>
      <div class="translation-header-tools">
        <ParallelModeToggle v-if="props.sourceText" v-model="viewMode" />
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
        <div
          v-if="qualityStatusText"
          class="translation-quality-alert"
          :class="qualityStatusClass"
        >
          {{ qualityStatusText }}
        </div>
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
        :altText="props.sourceText"
        :leftLetterKeys="leftLetterKeys"
        :spaceKey="spaceKey"
        :toEditorVisible="true"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import ParallelModeToggle, {
  type ParallelViewMode,
} from '../common/ParallelModeToggle.vue'
import ParallelTextPreview from '../common/ParallelTextPreview.vue'
import TextPreview from '../common/TextPreview.vue'
import type { TranslationQualityReport } from '@bozonx/ai-kit/translate'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  text: string
  sourceText?: string
  translationMeta?: {
    provider: string
    model?: string
    quality: TranslationQualityReport
  }
}>()

const TRANSLATION_VIEW_MODE_KEY = 'tyco-translation-view-mode'

function readStoredTranslationMode(): ParallelViewMode {
  try {
    const stored = localStorage.getItem(TRANSLATION_VIEW_MODE_KEY)
    if (stored === 'split' || stored === 'result') return stored
  } catch {
    // Ignore storage access errors
  }
  return 'split'
}

const currentText = ref(props.text)
watch(
  () => props.text,
  (newText) => {
    currentText.value = newText
  }
)

const viewMode = ref<ParallelViewMode>(
  props.sourceText ? readStoredTranslationMode() : 'result'
)

watch(viewMode, (newMode) => {
  try {
    localStorage.setItem(TRANSLATION_VIEW_MODE_KEY, newMode)
  } catch {
    // Ignore storage access errors
  }
})

function cycleMode() {
  if (!props.sourceText) return
  viewMode.value = viewMode.value === 'split' ? 'result' : 'split'
}

function handleKeyDown(event: KeyboardEvent) {
  if (
    event.key.toLowerCase() === 'd' &&
    (event.ctrlKey || event.altKey) &&
    !event.shiftKey
  ) {
    event.preventDefault()
    cycleMode()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

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

const qualityStatusClass = computed(() => {
  const quality = props.translationMeta?.quality
  if (!quality) return ''
  if (
    quality.repairFailed ||
    quality.remainingProblems.length ||
    quality.problems.length
  ) {
    return 'is-warning'
  }
  if (quality.repaired) {
    return 'is-info'
  }
  return 'is-success'
})

const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() => {
  return actionMenuStore.getShortcutActions()
})

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
)
</script>

<style scoped>
.preview-menu-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
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
  font-size: 0.75rem;
  color: var(--app-text-muted);
}

.translation-quality-alert {
  padding: var(--space-xs) var(--space-md);
  font-size: 0.8125rem;
  border-bottom: 1px solid var(--app-border-subtle);
}

.translation-quality-alert.is-warning {
  color: var(--color-warning);
  background-color: color-mix(in oklab, var(--color-warning) 10%, transparent);
}

.translation-quality-alert.is-info {
  color: var(--color-info);
  background-color: color-mix(in oklab, var(--color-info) 10%, transparent);
}

.translation-quality-alert.is-success {
  color: var(--color-success);
  background-color: color-mix(in oklab, var(--color-success) 10%, transparent);
}
</style>
