<template>
  <ActionOverlayLayout
    :title="t('menu.translate')"
    :on-esc="isPickerMode ? closePicker : undefined"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-if="isPickerMode"
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
        :empty-text="t('menu.translateNoLanguage')"
        :auto-highlight="query.trim() !== ''"
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
          <AppIcon icon="mdi:arrow-right" size="lg" class="translate-arrow" />
        </template>
        <template v-else #after-input>
          <AppIcon icon="mdi:arrow-right" size="lg" class="translate-arrow" />
          <LanguageField
            :label="t('menu.translateTargetLanguage')"
            :empty-text="t('menu.translateNotChosen')"
            @activate="switchField"
          />
        </template>
      </QueryPanel>
      <ShortcutList
        v-else
        :text="props.text"
        :space-key="otherLanguageAction"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="!editorNavigation.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { toolResultMessage } from '../../lib/invocation/invocation-result'
import {
  AUTO_LANGUAGE_VALUE,
  buildLanguageOptions,
  getLanguageLabelKey,
} from '../../lib/locale/language'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { TranslateMenuParams } from '../../lib/modals/menu-modal-params'
import { slotList } from '../../lib/shortcut-slots/shortcut-slots'
import { translationMetaOf } from '../../lib/translation/translation-meta'
import {
  type LanguageGroup,
  groupLanguages,
  languageSearchNames,
  nativeLanguageName,
} from '../../lib/translation/translation-picker'
import { type ActionItem } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import AppIcon from '../common/AppIcon.vue'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
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

const desktopStore = useDesktopStore()
const editorNavigation = useEditorNavigation()
const invocations = useInvocationsStore()
const menuModalsStore = useMenuModalsStore()
const runStep = useMenuStepRun()
const { toastKey, toastText } = useToast()
const { t } = useI18n()

const MIN_TRANSLATE_LENGTH = 2

/** The full language list instead of the configured keys */
const isPickerMode = ref(false)
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
  slotList(desktopStore.userConfig.translation.targetLanguages).map((lang) =>
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
    isPickerMode.value = true
  },
}

const closePicker = () => {
  isPickerMode.value = false
}

const recentLanguages = computed(
  () => desktopStore.sessionState?.recentTranslateLanguages ?? []
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

  void desktopStore.patchSessionState({
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
    toastKey('toast.noTextToTranslate', 'warn')
    return
  }

  if (sourceText.trim().length < MIN_TRANSLATE_LENGTH) {
    toastKey('toast.textTooShortToTranslate', 'warn')
    return
  }

  const stageLabels = {
    translating: 'menu.translationProgressTranslating',
    checking: 'menu.translationProgressChecking',
    repairing: 'menu.translationProgressRepairing',
  } as const
  await runStep({
    text: sourceText,
    operation: 'translation',
    pending: { label: t(stageLabels.translating) },
    invoke: (signal, updatePending) =>
      invocations.call('core.translate', sourceText, {
        signal,
        onProgress: (stage) => {
          if (stage in stageLabels)
            updatePending({
              label: t(stageLabels[stage as keyof typeof stageLabels]),
            })
        },
        toolConfig: { language: targetLanguage, sourceLanguage: source },
      }),
    read: (result) => {
      if (result.content !== undefined) return result.content
      toastText(toolResultMessage(result, t), 'error')
      return null
    },
    show: (text, result) =>
      menuModalsStore.nextModal(MenuModals.PREVIEW, {
        text,
        sourceText,
        translationMeta: translationMetaOf(result.meta),
      }),
  })
}

useMenuStartup({
  getValue: () => props.language,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) {
      menuModalsStore.updateStep(stepId, MenuModals.TRANSLATE, {
        language: undefined,
      })
    }
  },
  run: translate,
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
