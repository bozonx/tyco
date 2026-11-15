<template>
  <ActionOverlayLayout
    :other-actions-text="draftText"
    :title="t('menu.translate')"
    :on-esc="isPickerMode ? closePicker : undefined"
    :esc-mode="isPickerMode ? 'back' : 'auto'"
  >
    <template #preview>
      <ContextPreview
        v-model:text="draftText"
        editable
        :allow-disable="false"
      />
    </template>

    <template #actions>
      <div v-if="isPickerMode" class="translate-picker">
        <div class="translate-columns">
          <!-- Source language column -->
          <div
            class="translate-column"
            :class="{ 'is-active': activeField === 'source' }"
            data-field="source"
          >
            <div class="translate-column-header">
              <span class="translate-column-label">{{
                t('menu.translateSourceLanguage')
              }}</span>
              <span
                v-if="sourceLanguage !== AUTO_LANGUAGE_VALUE"
                class="translate-column-selected"
              >
                {{ sourceLabel }}
              </span>
            </div>

            <input
              ref="sourceInputRef"
              v-model="sourceQuery"
              type="text"
              class="translate-column-input"
              data-field="source"
              :disabled="isInputDisabled"
              :placeholder="t('menu.translateSourcePlaceholder')"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="sourceOptions.length > 0"
              aria-controls="translate-source-list"
              :aria-activedescendant="
                highlightedSourceIndex >= 0
                  ? `translate-source-option-${highlightedSourceIndex}`
                  : undefined
              "
              spellcheck="false"
              autocomplete="off"
              @focus="activeField = 'source'"
              @keydown="onKeyDown($event, 'source')"
            />

            <ul
              v-if="sourceOptions.length > 0"
              id="translate-source-list"
              ref="sourceListRef"
              class="translate-column-options"
              role="listbox"
            >
              <template
                v-for="(option, index) in sourceOptions"
                :key="option.id"
              >
                <li
                  v-if="
                    option.group &&
                    option.group !== sourceOptions[index - 1]?.group
                  "
                  class="translate-group"
                  role="presentation"
                >
                  {{ option.group }}
                </li>
                <li
                  :id="`translate-source-option-${index}`"
                  role="option"
                  class="translate-option"
                  :class="{
                    'is-highlighted':
                      index === highlightedSourceIndex &&
                      activeField === 'source',
                    'is-selected': option.selected,
                  }"
                  :aria-selected="
                    index === highlightedSourceIndex && activeField === 'source'
                  "
                  :data-option-id="option.id"
                  @mousedown.prevent
                  @click="submitSource(option)"
                >
                  <span class="translate-option-label">
                    <AppIcon
                      v-if="option.icon"
                      :icon="option.icon"
                      size="md"
                      class="translate-option-icon"
                    />
                    <span class="translate-option-text">{{
                      option.label
                    }}</span>
                  </span>
                  <span class="translate-option-end">
                    <span v-if="option.hint" class="translate-option-hint">{{
                      option.hint
                    }}</span>
                    <AppIcon
                      v-if="option.selected"
                      icon="mdi:check"
                      size="md"
                      class="translate-option-check"
                    />
                  </span>
                </li>
              </template>
            </ul>
            <p v-else class="translate-empty">
              {{ t('menu.translateNoLanguage') }}
            </p>
          </div>

          <!-- Divider with arrow -->
          <div class="translate-divider" aria-hidden="true">
            <AppIcon icon="mdi:arrow-right" size="lg" class="translate-arrow" />
          </div>

          <!-- Target language column -->
          <div
            class="translate-column"
            :class="{ 'is-active': activeField === 'target' }"
            data-field="target"
          >
            <div class="translate-column-header">
              <span class="translate-column-label">{{
                t('menu.translateTargetLanguage')
              }}</span>
            </div>

            <input
              ref="targetInputRef"
              v-model="targetQuery"
              type="text"
              class="translate-column-input"
              data-field="target"
              :disabled="isInputDisabled"
              :placeholder="t('menu.translateTargetPlaceholder')"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="targetOptions.length > 0"
              aria-controls="translate-target-list"
              :aria-activedescendant="
                highlightedTargetIndex >= 0
                  ? `translate-target-option-${highlightedTargetIndex}`
                  : undefined
              "
              spellcheck="false"
              autocomplete="off"
              @focus="activeField = 'target'"
              @keydown="onKeyDown($event, 'target')"
            />

            <ul
              v-if="targetOptions.length > 0"
              id="translate-target-list"
              ref="targetListRef"
              class="translate-column-options"
              role="listbox"
            >
              <template
                v-for="(option, index) in targetOptions"
                :key="option.id"
              >
                <li
                  v-if="
                    option.group &&
                    option.group !== targetOptions[index - 1]?.group
                  "
                  class="translate-group"
                  role="presentation"
                >
                  {{ option.group }}
                </li>
                <li
                  :id="`translate-target-option-${index}`"
                  role="option"
                  class="translate-option"
                  :class="{
                    'is-highlighted':
                      index === highlightedTargetIndex &&
                      activeField === 'target',
                    'is-selected': option.selected,
                  }"
                  :aria-selected="
                    index === highlightedTargetIndex && activeField === 'target'
                  "
                  :data-option-id="option.id"
                  @mousedown.prevent
                  @click="submitTarget(option)"
                >
                  <span class="translate-option-label">
                    <AppIcon
                      v-if="option.icon"
                      :icon="option.icon"
                      size="md"
                      class="translate-option-icon"
                    />
                    <span class="translate-option-text">{{
                      option.label
                    }}</span>
                  </span>
                  <span class="translate-option-end">
                    <span v-if="option.hint" class="translate-option-hint">{{
                      option.hint
                    }}</span>
                    <AppIcon
                      v-if="option.selected"
                      icon="mdi:check"
                      size="md"
                      class="translate-option-check"
                    />
                  </span>
                </li>
              </template>
            </ul>
            <p v-else class="translate-empty">
              {{ t('menu.translateNoLanguage') }}
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div class="translate-footer">
          <div class="translate-hints">
            <ShortcutHint
              v-for="hint in pickerHints"
              :key="hint.label"
              :keys="hint.keys"
              interactive
              :disabled="props.shortcutsDisabled || hint.disabled"
              @click="hint.action?.()"
            >
              {{ hint.label }}
            </ShortcutHint>
          </div>
        </div>
      </div>
      <ShortcutList
        v-else
        :text="draftText"
        :space-key="otherLanguageAction"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { isCjkText } from '../../lib/action-menu/action-text-requirement'
import { toolResultMessage } from '../../lib/invocation/invocation-result'
import { AUTO_LANGUAGE_VALUE } from '../../lib/locale/language'
import {
  filterOptions,
  moveHighlight,
  pushRecent,
} from '../../lib/menu-query/menu-query'
import type { TranslateMenuParams } from '../../lib/modals/menu-modal-params'
import { slotList } from '../../lib/shortcut-slots/shortcut-slots'
import {
  resolveTranslationLanguage,
  translationLanguageIds,
  translationLanguageLabel,
} from '../../lib/translation/translation-languages'
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
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import ShortcutHint from '../overlay/ShortcutHint.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import type { QueryPanelOption } from './QueryPanel.vue'
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<TranslateMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  language: undefined,
})

const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const menuModalsStore = useMenuModalsStore()
const draftStepId = menuModalsStore.currentStepId
const draftText = ref(props.text)
watch(
  () => props.text,
  (text) => {
    draftText.value = text
  }
)
watch(draftText, (text) => {
  const id = draftStepId
  if (id !== undefined)
    menuModalsStore.updateStep(id, MenuModals.TRANSLATE, { text })
})
const runStep = useMenuStepRun()
const { toastKey, toastText } = useToast()
const { t, locale } = useI18n()

/** The full language list instead of the configured keys */
const isPickerMode = ref(false)
/** Which column currently has active focus */
const activeField = ref<'target' | 'source'>('target')
const sourceQuery = ref('')
const targetQuery = ref('')
/** Picked anew each time the menu opens: an old pick is easily forgotten */
const sourceLanguage = ref(AUTO_LANGUAGE_VALUE)

const sourceInputRef = ref<HTMLInputElement | null>(null)
const targetInputRef = ref<HTMLInputElement | null>(null)
const sourceListRef = ref<HTMLUListElement | null>(null)
const targetListRef = ref<HTMLUListElement | null>(null)

const highlightedSourceIndex = ref(-1)
const highlightedTargetIndex = ref(-1)

const isInputDisabled = computed(
  () => props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
)

const languageLabel = (id: string): string =>
  translationLanguageLabel(id, locale.value)
const provider = computed(() => desktopStore.userConfig.translation.provider)
const languageIds = (direction: 'source' | 'target') =>
  translationLanguageIds(provider.value, direction)
const recentFor = (direction: 'source' | 'target') =>
  recentLanguages.value.flatMap(
    (id) => resolveTranslationLanguage(id, provider.value, direction) ?? []
  )

watch(provider, () => {
  sourceLanguage.value = AUTO_LANGUAGE_VALUE
})

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  slotList(desktopStore.userConfig.translation.targetLanguages).map((lang) =>
    lang
      ? {
          name: languageLabel(lang),
          action: async () => {
            await translate(lang, pickedSourceLanguage())
          },
        }
      : undefined
  )
)

const otherLanguageAction: ActionItem = {
  labelKey: 'menu.translateOtherLanguage',
  icon: 'mdi:translate-variant',
  action: async () => {
    activeField.value = 'target'
    sourceQuery.value = ''
    targetQuery.value = ''
    isPickerMode.value = true
    await nextTick()
    targetInputRef.value?.focus()
  },
}

const closePicker = () => {
  isPickerMode.value = false
}

const recentLanguages = computed(
  () => desktopStore.sessionState?.recentTranslateLanguages ?? []
)

const AUTO_ICON = 'mdi:auto-mode'

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

const rawSourceOptions = computed<QueryPanelOption[]>(() => [
  {
    id: AUTO_LANGUAGE_VALUE,
    label: t('menu.translateAutoDetect'),
    icon: AUTO_ICON,
    keywords: ['auto'],
    selected: sourceLanguage.value === AUTO_LANGUAGE_VALUE,
  },
  ...groupLanguages(
    recentFor('source'),
    languageIds('source'),
    languageLabel,
    undefined,
    locale.value
  ).map(({ id, group }) => toOption(id, group, id === sourceLanguage.value)),
])

const sourceOptions = computed<QueryPanelOption[]>(() =>
  sourceQuery.value.trim()
    ? filterOptions(rawSourceOptions.value, sourceQuery.value).map(
        (option) => ({ ...option, group: undefined })
      )
    : rawSourceOptions.value
)

const rawTargetOptions = computed<QueryPanelOption[]>(() =>
  groupLanguages(
    recentFor('target'),
    languageIds('target'),
    languageLabel,
    sourceLanguage.value === AUTO_LANGUAGE_VALUE
      ? undefined
      : sourceLanguage.value,
    locale.value
  ).map(({ id, group }) => toOption(id, group))
)

const targetOptions = computed<QueryPanelOption[]>(() =>
  targetQuery.value.trim()
    ? filterOptions(rawTargetOptions.value, targetQuery.value).map(
        (option) => ({ ...option, group: undefined })
      )
    : rawTargetOptions.value
)

const isAutoSource = computed(
  () => sourceLanguage.value === AUTO_LANGUAGE_VALUE
)

const sourceLabel = computed(() =>
  isAutoSource.value
    ? t('menu.translateAutoDetect')
    : languageLabel(sourceLanguage.value)
)

function scrollToHighlighted(column: 'source' | 'target') {
  void nextTick(() => {
    const index =
      column === 'source'
        ? highlightedSourceIndex.value
        : highlightedTargetIndex.value
    if (index >= 0) {
      document
        .getElementById(`translate-${column}-option-${index}`)
        ?.scrollIntoView?.({ block: 'nearest' })
    }
  })
}

watch(targetOptions, () => {
  if (targetQuery.value.trim() !== '' && targetOptions.value.length > 0) {
    highlightedTargetIndex.value = 0
  } else {
    highlightedTargetIndex.value = -1
  }
  if (highlightedTargetIndex.value >= 0) {
    scrollToHighlighted('target')
  }
})

watch(
  [sourceOptions, sourceLanguage],
  () => {
    if (sourceQuery.value.trim() !== '' && sourceOptions.value.length > 0) {
      highlightedSourceIndex.value = 0
    } else {
      const selectedIndex = sourceOptions.value.findIndex((o) => o.selected)
      highlightedSourceIndex.value = selectedIndex >= 0 ? selectedIndex : -1
    }
    if (highlightedSourceIndex.value >= 0) {
      scrollToHighlighted('source')
    }
  },
  { immediate: true }
)

const pickerHints = computed(() => [
  {
    keys: ['Enter'],
    label:
      activeField.value === 'source'
        ? t('menu.translatePickSource')
        : t('menu.translate'),
    disabled:
      activeField.value === 'source'
        ? highlightedSourceIndex.value < 0
        : highlightedTargetIndex.value < 0,
    action: () => {
      if (activeField.value === 'source') {
        submitSource()
      } else {
        void submitTarget()
      }
    },
  },
  {
    keys: ['Tab'],
    label: t('menu.translateSwitchField'),
    disabled: false,
    action: switchField,
  },
])

function switchField() {
  if (activeField.value === 'source') {
    activeField.value = 'target'
    void nextTick(() => targetInputRef.value?.focus())
  } else {
    activeField.value = 'source'
    void nextTick(() => sourceInputRef.value?.focus())
  }
}

function submitSource(option?: QueryPanelOption) {
  if (isInputDisabled.value) return
  const chosen = option ?? sourceOptions.value[highlightedSourceIndex.value]
  if (!chosen) return

  sourceLanguage.value = chosen.id
  sourceQuery.value = ''
  activeField.value = 'target'
  void nextTick(() => targetInputRef.value?.focus())
}

async function submitTarget(option?: QueryPanelOption) {
  if (isInputDisabled.value) return
  const chosen = option ?? targetOptions.value[highlightedTargetIndex.value]
  if (!chosen) return

  void desktopStore.patchSessionState({
    recentTranslateLanguages: pushRecent(recentLanguages.value, chosen.id),
  })
  await translate(chosen.id, pickedSourceLanguage())
}

function onKeyDown(event: KeyboardEvent, column: 'source' | 'target') {
  if (isInputDisabled.value || event.isComposing) return

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      if (column === 'target') {
        highlightedTargetIndex.value = moveHighlight(
          highlightedTargetIndex.value,
          delta,
          targetOptions.value.length
        )
        scrollToHighlighted('target')
      } else {
        highlightedSourceIndex.value = moveHighlight(
          highlightedSourceIndex.value,
          delta,
          sourceOptions.value.length
        )
        scrollToHighlighted('source')
      }
      return
    }
    case 'Tab': {
      event.preventDefault()
      switchField()
      return
    }
    case 'Enter': {
      event.preventDefault()
      if (event.repeat) return
      if (column === 'source') {
        submitSource()
      } else {
        void submitTarget()
      }
      return
    }
    case 'Escape': {
      event.preventDefault()
      closePicker()
      return
    }
  }
}

/** The source language the user picked; undefined lets the translator detect it */
function pickedSourceLanguage(): string | undefined {
  return sourceLanguage.value === AUTO_LANGUAGE_VALUE
    ? undefined
    : sourceLanguage.value
}

const translate = async (targetLanguage: string, source?: string) => {
  const sourceText = draftText.value

  if (!sourceText.trim()) {
    toastKey('toast.noTextToTranslate', 'warn')
    return
  }

  const trimmed = sourceText.trim()
  if (!isCjkText(trimmed) && trimmed.length < APP_CONFIG.minTranslationLength) {
    toastKey('toast.textTooShortToTranslate', 'warn')
    return
  }

  if (source === targetLanguage) {
    toastKey('toast.sameTranslationLanguage', 'warn')
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
          if (Object.hasOwn(stageLabels, stage))
            updatePending({
              label: t(stageLabels[stage as keyof typeof stageLabels]),
            })
        },
        operationConfig: { language: targetLanguage, sourceLanguage: source },
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
.translate-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.translate-columns {
  display: flex;
  align-items: stretch;
  gap: var(--space-sm);
  width: 100%;
  min-height: 0;
}

.translate-column {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-2xs);
}

.translate-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  min-height: 1.125rem;
  padding: 0 var(--space-2xs);
}

.translate-column-label {
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-faint);
  transition: color var(--transition-fast);
}

.translate-column.is-active .translate-column-label {
  color: var(--color-primary);
}

.translate-column-selected {
  font-size: var(--text-micro);
  color: var(--app-text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.translate-column-input {
  width: 100%;
  min-width: 0;
  height: var(--control-size-md);
  padding: 0 var(--space-md);
  border: 1px solid var(--quick-field-border);
  border-radius: var(--quick-tile-radius);
  background-color: var(--quick-field-bg);
  color: var(--color-base-content);
  font-size: var(--text-title);
  outline: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.translate-column.is-active .translate-column-input:focus,
.translate-column-input:focus {
  border-color: var(--quick-field-border-focus);
  box-shadow: var(--app-focus-ring);
}

.translate-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding-top: 1.25rem;
  color: var(--app-text-faint);
}

.translate-arrow {
  flex-shrink: 0;
  color: var(--app-text-faint);
}

.translate-column-options {
  display: flex;
  flex-direction: column;
  height: 9.5rem;
  margin: 0;
  padding: var(--space-xs);
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  transition: border-color var(--transition-fast);
}

.translate-column.is-active .translate-column-options {
  border-color: var(--app-border);
}

.translate-group {
  padding: var(--space-sm) var(--space-sm) var(--space-2xs);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.translate-group:first-child {
  padding-top: var(--space-2xs);
}

.translate-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: var(--control-size-sm);
  padding: 0 var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-body);
  cursor: pointer;
  user-select: none;
}

.translate-option:hover:not(.is-highlighted) {
  background-color: var(--app-hover);
}

.translate-column.is-active .translate-option.is-highlighted {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.translate-option.is-selected {
  font-weight: 600;
}

.translate-option-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.translate-option-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.translate-option-icon {
  flex-shrink: 0;
}

.translate-option-end {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
}

.translate-option-check {
  color: var(--color-primary);
}

.translate-option-hint {
  flex-shrink: 0;
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}

.translate-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 9.5rem;
  margin: 0;
  padding: 0.5rem;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.translate-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs) var(--space-md);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}

.translate-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-md);
}
</style>
