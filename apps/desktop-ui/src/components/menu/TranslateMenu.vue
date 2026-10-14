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
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
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
        :autoHighlight="query.trim() !== ''"
        @submit="submitLanguage"
        @back="closePicker"
      >
        <template v-if="field === 'target'" #before-input>
          <LanguageField
            :label="t('menu.translateSourceLanguage')"
            :value="sourceLabel"
            :icon="sourceIcon"
            @activate="switchField"
          />
          <Icon icon="mdi:arrow-right" height="18" class="translate-arrow" />
        </template>
        <template v-else #after-input>
          <Icon icon="mdi:arrow-right" height="18" class="translate-arrow" />
          <LanguageField
            :label="t('menu.translateTargetLanguage')"
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
        :shortcutsDisabled="props.shortcutsDisabled"
        :isEditorButtonVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { toolResultMessage } from '../../lib/invocation/invocation-result'
import {
  AUTO_LANGUAGE_VALUE,
  buildLanguageOptions,
  getLanguageLabelKey,
} from '../../lib/locale/language'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { TranslateMenuParams } from '../../lib/modals/menu-modal-params'
import {
  type LanguageGroup,
  groupLanguages,
  languageSearchNames,
  nativeLanguageName,
} from '../../lib/translate-picker/translate-picker'
import { translationMetaOf } from '../../lib/translation/translation-meta'
import { type ActionItem } from '../../stores/action-menu'
import { useHistoryStore } from '../../stores/history'
import { useInvocationsStore } from '../../stores/invocations'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Icon from '../common/AppIcon.vue'
import TextPreview from '../common/TextPreview.vue'
import LanguageField from './LanguageField.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'

const props = withDefaults(defineProps<TranslateMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  language: undefined,
})

const ipcStore = useIpcStore()
const routeParamsStore = useEditorNavigation()
const invocations = useInvocationsStore()
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
/** Picked anew each time the menu opens: an old pick is easily forgotten */
const sourceLanguage = ref(AUTO_LANGUAGE_VALUE)

const languageLabel = (id: string): string => {
  const key = getLanguageLabelKey(id)
  const label = t(key)
  return label === key ? (nativeLanguageName(id) ?? id) : label
}

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  ipcStore.desktopState.userConfig.toTranslateLanguages.map(
    (lang: string | null) =>
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
  () => ipcStore.desktopState.sessionState?.recentTranslateLanguages ?? []
)

const ALL_LANGUAGES = buildLanguageOptions([], false).map((option) => option.id)

const AUTO_ICON = 'mdi:auto-fix'

const GROUP_LABELS: Record<LanguageGroup, string> = {
  recent: 'menu.translateGroupRecent',
  all: 'menu.translateGroupAll',
}

const toOption = (
  id: string,
  group: LanguageGroup,
  selected = false
): QueryPanelOption => {
  const label = languageLabel(id)
  const native = nativeLanguageName(id)
  return {
    id,
    label,
    hint: native && native !== label ? native : undefined,
    keywords: languageSearchNames(id),
    group: t(GROUP_LABELS[group]),
    selected,
  }
}

/**
 * The list of the searched field; the target list leaves out the source
 * language, and auto-detect leads the source list
 */
const fieldOptions = computed<QueryPanelOption[]>(() => {
  if (field.value === 'target') {
    return groupLanguages(
      recentLanguages.value,
      ALL_LANGUAGES,
      languageLabel,
      sourceLanguage.value
    ).map(({ id, group }) => toOption(id, group))
  }

  return [
    {
      id: AUTO_LANGUAGE_VALUE,
      label: t('menu.translateAutoDetect'),
      icon: AUTO_ICON,
      keywords: ['auto'],
      selected: sourceLanguage.value === AUTO_LANGUAGE_VALUE,
    },
    ...groupLanguages(recentLanguages.value, ALL_LANGUAGES, languageLabel).map(
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

const pickerHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label:
      field.value === 'source'
        ? t('menu.translatePickSource')
        : t('menu.translate'),
    // nothing is highlighted in the target list until the user types or moves
    disabled: pickerOptions.value.length === 0,
    requireOption: true,
  },
  { keys: [], label: t('menu.translateSwitchField'), action: switchField },
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

  void ipcStore.patchSessionState({
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

  // the menu step, when the menu is one: closing it hides the result
  const stepId = menuModalsStore.currentStepId
  const controller = new AbortController()
  const stageLabels = {
    translating: 'menu.translationProgressTranslating',
    checking: 'menu.translationProgressChecking',
    repairing: 'menu.translationProgressRepairing',
  } as const
  const owner = menuModalsStore.setPendingModal({
    label: t(stageLabels.translating),
    onCancel: () => controller.abort(),
  })
  const setStage = (stage: string) => {
    if (controller.signal.aborted || !(stage in stageLabels)) return
    menuModalsStore.setPendingModal(
      {
        label: t(stageLabels[stage as keyof typeof stageLabels]),
        onCancel: () => controller.abort(),
      },
      owner
    )
  }
  try {
    const sourceId = await historyStore.saveSource(sourceText, 'translate')
    if (controller.signal.aborted) return
    const result = await invocations.call('core.translate', sourceText, {
      signal: controller.signal,
      onProgress: setStage,
      toolConfig: { language: targetLanguage, sourceLanguage: source },
    })
    if (result.cancelled || controller.signal.aborted) return
    if (!result.ok || result.content === undefined) {
      toastText(toolResultMessage(result, t), 'error')
      return
    }
    const text = result.content
    await historyStore.saveSourceResult(sourceId, text).catch(() => {
      toast('history.operationFailed', 'error')
    })
    // closed meanwhile: the result is in the history, not on the screen
    if (controller.signal.aborted) return
    if (stepId !== undefined && !menuModalsStore.hasStep(stepId)) return
    menuModalsStore.nextModal(MenuModals.PREVIEW, {
      text,
      sourceText,
      translationMeta: translationMetaOf(result.meta),
    })
  } catch (error) {
    if (controller.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    toastText(message, 'error')
  } finally {
    menuModalsStore.clearPendingModal(owner)
  }
}

// once: back on this step from the result, the menu waits for a choice
onMounted(() => {
  const language = props.language
  if (!language) return
  const stepId = menuModalsStore.currentStepId
  if (stepId !== undefined) {
    menuModalsStore.updateStep(stepId, MenuModals.TRANSLATE, {
      language: undefined,
    })
  }
  void translate(language)
})
</script>

<style scoped>
.translate-arrow {
  flex-shrink: 0;
  align-self: flex-end;
  margin-bottom: 0.5625rem;
  color: var(--app-text-faint);
}
</style>
