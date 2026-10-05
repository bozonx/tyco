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
        :label="
          field === 'source'
            ? t('menu.translateSourceLanguage')
            : t('menu.translateTargetLanguage')
        "
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
        @keydown="onPickerKeyDown"
      >
        <template v-if="field === 'target'" #before-input>
          <LanguageField
            :label="t('menu.translateSourceLanguage')"
            :value="sourceLabel"
            :icon="sourceIcon"
            @activate="switchField"
          />
          <button
            type="button"
            class="translate-swap"
            :title="`${t('menu.translateSwap')} (Alt+S)`"
            :disabled="!swappable"
            @mousedown.prevent
            @click="swapLanguages"
          >
            <Icon icon="mdi:swap-horizontal" height="18" />
          </button>
        </template>
        <template v-else #after-input>
          <button
            type="button"
            class="translate-swap"
            :title="`${t('menu.translateSwap')} (Alt+S)`"
            :disabled="!swappable"
            @mousedown.prevent
            @click="swapLanguages"
          >
            <Icon icon="mdi:swap-horizontal" height="18" />
          </button>
          <LanguageField
            :label="t('menu.translateTargetLanguage')"
            :value="targetLanguage ? languageLabel(targetLanguage) : ''"
            :emptyText="t('menu.translateNotChosen')"
            @activate="switchField"
          />
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
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import {
  type LanguageGroup,
  canSwapLanguages,
  defaultTargetLanguage,
  groupLanguages,
} from '../../lib/translate-picker/translate-picker'
import { type ActionItem } from '../../stores/actionMenu'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'
import LanguageField from './LanguageField.vue'
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
const sourceLanguage = ref(
  ipcStore.params.localState?.translateSourceLanguage ?? AUTO_LANGUAGE_VALUE
)
/** The language Enter translates into while nothing else is typed */
const targetLanguage = ref<string>()

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

const recentLanguages = computed(
  () => ipcStore.params.localState?.recentTranslateLanguages ?? []
)

const languageSources = computed(() => ({
  recent: recentLanguages.value,
  configured: ipcStore.params.userConfig.toTranslateLanguages,
  all: buildLanguageOptions([], false).map((option) => option.id),
}))

const otherLanguageAction: ActionItem = {
  labelKey: 'menu.translateOtherLanguage',
  icon: 'mdi:translate-variant',
  action: async () => {
    field.value = 'target'
    query.value = ''
    targetLanguage.value ??= defaultTargetLanguage(
      languageSources.value,
      sourceLanguage.value
    )
    pickerMode.value = true
  },
}

const closePicker = () => {
  pickerMode.value = false
}

const AUTO_ICON = 'mdi:auto-fix'

const GROUP_LABELS: Record<LanguageGroup, string> = {
  recent: 'menu.translateGroupRecent',
  mine: 'menu.translateGroupMine',
  all: 'menu.translateGroupAll',
}

const toOption = (
  id: string,
  group: LanguageGroup,
  selected: boolean
): QueryPanelOption => {
  const label = languageLabel(id)
  const native = NATIVE_NAMES.get(id)
  return {
    id,
    label,
    hint: native && native !== label ? native : undefined,
    keywords: native ? [native] : [],
    group: t(GROUP_LABELS[group]),
    selected,
  }
}

/**
 * The list of the searched field without the language of the other one;
 * auto-detect leads the source list
 */
const fieldOptions = computed<QueryPanelOption[]>(() => {
  if (field.value === 'target') {
    return groupLanguages(languageSources.value, sourceLanguage.value).map(
      ({ id, group }) => toOption(id, group, id === targetLanguage.value)
    )
  }

  return [
    {
      id: AUTO_LANGUAGE_VALUE,
      label: t('menu.translateAutoDetect'),
      icon: AUTO_ICON,
      keywords: ['auto'],
      selected: sourceLanguage.value === AUTO_LANGUAGE_VALUE,
    },
    ...groupLanguages(languageSources.value, targetLanguage.value).map(
      ({ id, group }) => toOption(id, group, id === sourceLanguage.value)
    ),
  ]
})

/** While searching, the matches are ordered by relevance, so not grouped */
const pickerOptions = computed(() =>
  query.value.trim()
    ? filterOptions(fieldOptions.value, query.value).map((option) => ({
        ...option,
        group: undefined,
      }))
    : fieldOptions.value
)

const isAutoSource = computed(
  () => sourceLanguage.value === AUTO_LANGUAGE_VALUE
)

const sourceLabel = computed(() =>
  isAutoSource.value
    ? t('menu.translateAutoDetect')
    : languageLabel(sourceLanguage.value)
)

const sourceIcon = computed(() => (isAutoSource.value ? AUTO_ICON : ''))

const swappable = computed(() =>
  canSwapLanguages(sourceLanguage.value, targetLanguage.value)
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
  { keys: ['Tab'], label: t('menu.translateSwitchField'), action: switchField },
  {
    keys: ['Alt', 'S'],
    label: t('menu.translateSwap'),
    disabled: !swappable.value,
    action: swapLanguages,
  },
  { keys: ['Esc'], label: t('common.back'), action: closePicker },
])

function switchField() {
  field.value = field.value === 'source' ? 'target' : 'source'
  query.value = ''
}

function setSourceLanguage(id: string) {
  sourceLanguage.value = id
  void ipcStore.patchLocalState({
    translateSourceLanguage: id === AUTO_LANGUAGE_VALUE ? null : id,
  })
}

function swapLanguages() {
  const target = targetLanguage.value
  if (!canSwapLanguages(sourceLanguage.value, target)) return

  targetLanguage.value = sourceLanguage.value
  setSourceLanguage(target)
  query.value = ''
}

function onPickerKeyDown(event: KeyboardEvent) {
  if (
    event.altKey &&
    event.code === 'KeyS' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    event.preventDefault()
    swapLanguages()
  }
}

async function submitLanguage({ option }: QueryPanelSubmit) {
  if (!option) return

  if (field.value === 'source') {
    setSourceLanguage(option.id)
    if (targetLanguage.value === option.id) targetLanguage.value = undefined
    field.value = 'target'
    query.value = ''
    return
  }

  targetLanguage.value = option.id

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
.translate-swap {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
}

.translate-swap:hover:not(:disabled) {
  border-color: var(--app-border);
  background-color: var(--app-hover);
  color: var(--color-base-content);
}

.translate-swap:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
