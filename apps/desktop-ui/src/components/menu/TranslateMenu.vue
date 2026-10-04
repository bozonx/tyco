<template>
  <ActionOverlayLayout
    :title="t('menu.translate')"
    :onEsc="pickerMode ? closePicker : undefined"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-if="pickerMode"
        v-model="query"
        :placeholder="
          field === 'source'
            ? t('menu.translateSourcePlaceholder')
            : t('menu.translateTargetPlaceholder')
        "
        :options="pickerOptions"
        :hints="pickerHints"
        :emptyText="t('menu.translateNoLanguage')"
        autoHighlight
        @submit="submitLanguage"
        @tab="switchField"
        @back="closePicker"
      >
        <template #before-input>
          <button
            type="button"
            class="translate-source"
            :class="{ 'is-active': field === 'source' }"
            :title="t('menu.translateSourceHint')"
            @mousedown.prevent
            @click="switchField"
          >
            {{ t('menu.translateFrom') }}
            <strong>{{ sourceLabel }}</strong>
          </button>
          <Icon icon="mdi:arrow-right" height="16" class="translate-arrow" />
        </template>
      </QueryPanel>
      <ShortcutList
        v-else
        :text="props.text"
        :spaceKey="otherLanguageAction"
        :leftLetterKeys="leftLetterKeys"
        :toEditorVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import {
  AUTO_LANGUAGE_VALUE,
  SUPPORTED_USER_LANGUAGE_OPTIONS,
  buildLanguageOptions,
  getLanguageLabel,
} from '../../lib/locale/language'
import {
  filterOptions,
  pushRecent,
  uniqueIds,
} from '../../lib/menu-query/menu-query'
import { type ActionItem } from '../../stores/actionMenu'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{ text?: string }>(), { text: '' })

const ipcStore = useIpcStore()
const routeParamsStore = useRouteParams()
const { translateTo } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast, toastText } = useToast()
const { t } = useI18n()

const MIN_TRANSLATE_LENGTH = 2

/** The full language list instead of the configured keys */
const pickerMode = ref(false)
/** Which language the input picks */
const field = ref<'target' | 'source'>('target')
const query = ref('')
const sourceLanguage = ref(AUTO_LANGUAGE_VALUE)

const NATIVE_NAMES = new Map<string, string>(
  SUPPORTED_USER_LANGUAGE_OPTIONS.map((option) => [option.id, option.name])
)

const languageLabel = (id: string): string => {
  const key = getLanguageLabel(id)
  const label = t(key)
  return label === key ? (NATIVE_NAMES.get(id) ?? id) : label
}

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  ipcStore.params.userConfig.toTranslateLanguages.map((lang: string | null) =>
    lang
      ? {
          name: languageLabel(lang),
          action: async () => {
            await translate(lang)
          },
        }
      : undefined
  )
)

const otherLanguageAction: ActionItem = {
  labelKey: 'menu.translateOtherLanguage',
  icon: 'mdi:translate-variant',
  action: async () => {
    field.value = 'target'
    query.value = ''
    pickerMode.value = true
  },
}

const closePicker = () => {
  pickerMode.value = false
}

const recentLanguages = computed(
  () => ipcStore.params.localState?.recentTranslateLanguages ?? []
)

const toOption = (id: string): QueryPanelOption => {
  const label = languageLabel(id)
  const native = NATIVE_NAMES.get(id)
  return {
    id,
    label,
    hint: native && native !== label ? native : undefined,
    keywords: native ? [native] : [],
  }
}

/** Recent picks first, then the configured languages, then all the others */
const targetOptions = computed<QueryPanelOption[]>(() =>
  uniqueIds(
    [
      ...recentLanguages.value,
      ...ipcStore.params.userConfig.toTranslateLanguages.filter(
        (lang: string | null): lang is string => Boolean(lang)
      ),
      ...buildLanguageOptions([], false).map((option) => option.id),
    ].map(toOption)
  )
)

const sourceOptions = computed<QueryPanelOption[]>(() => [
  {
    id: AUTO_LANGUAGE_VALUE,
    label: t('menu.translateAutoDetect'),
    keywords: ['auto'],
  },
  ...targetOptions.value,
])

const pickerOptions = computed(() =>
  filterOptions(
    field.value === 'source' ? sourceOptions.value : targetOptions.value,
    query.value
  )
)

const sourceLabel = computed(() =>
  sourceLanguage.value === AUTO_LANGUAGE_VALUE
    ? t('menu.translateAutoDetect')
    : languageLabel(sourceLanguage.value)
)

const pickerHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label:
      field.value === 'source'
        ? t('menu.translatePickSource')
        : t('menu.translate'),
    disabled: pickerOptions.value.length === 0,
  },
  {
    keys: ['Tab'],
    label:
      field.value === 'source'
        ? t('menu.translateTargetLanguage')
        : t('menu.translateSourceLanguage'),
    action: switchField,
  },
  { keys: ['Esc'], label: t('common.back'), action: closePicker },
])

function switchField() {
  field.value = field.value === 'source' ? 'target' : 'source'
  query.value = ''
}

async function submitLanguage({ option }: QueryPanelSubmit) {
  if (!option) return

  if (field.value === 'source') {
    sourceLanguage.value = option.id
    field.value = 'target'
    query.value = ''
    return
  }

  void ipcStore.patchLocalState({
    recentTranslateLanguages: pushRecent(recentLanguages.value, option.id),
  })
  await translate(
    option.id,
    sourceLanguage.value === AUTO_LANGUAGE_VALUE
      ? undefined
      : sourceLanguage.value
  )
}

const translate = async (targetLanguage: string, source?: string) => {
  const sourceText = props.text

  if (!sourceText.trim()) {
    toast('toast.noTextToTranslate', 'warn')
    return
  }

  if (sourceText.trim().length < MIN_TRANSLATE_LENGTH) {
    toast('toast.textTooShortToTranslate', 'warn')
    return
  }

  const sourceId = await historyStore.saveSource(sourceText, 'translate')

  // the menu step, when the menu is one: closing it hides the result
  const stepId = menuModalsStore.currentStepId
  const controller = new AbortController()
  const stageLabels = {
    translating: 'translationProgressTranslating',
    checking: 'translationProgressChecking',
    repairing: 'translationProgressRepairing',
  } as const
  const setStage = (stage: keyof typeof stageLabels) =>
    menuModalsStore.setPendingModal({
      label: t(`menu.${stageLabels[stage]}`),
      onCancel: () => controller.abort(),
    })
  setStage('translating')
  try {
    const result = await translateTo(targetLanguage, sourceText, {
      signal: controller.signal,
      onStage: setStage,
      sourceLanguage: source,
    })
    if (!result) return
    await historyStore.saveSourceResult(sourceId, result.text).catch(() => {
      toast('history.operationFailed', 'error')
    })
    // closed meanwhile: the result is in the history, not on the screen
    if (stepId !== undefined && !menuModalsStore.hasStep(stepId)) return
    menuModalsStore.nextModal(MenuModals.PREVIEW, {
      text: result.text,
      sourceText,
      translationMeta: {
        provider: result.provider,
        kind: result.kind,
        model: result.model,
        quality: result.quality,
      },
    })
  } catch (error) {
    if (controller.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    toastText(message, 'error')
  } finally {
    menuModalsStore.clearPendingModal()
  }
}
</script>

<style scoped>
.translate-source {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  height: 2.25rem;
  padding: 0 0.625rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
}

.translate-source strong {
  font-weight: 600;
  color: var(--color-base-content);
}

.translate-source.is-active {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  background-color: var(--app-accent-soft);
}

.translate-arrow {
  flex-shrink: 0;
  color: var(--app-text-faint);
}
</style>
