<template>
  <ActionOverlayLayout
    :other-actions-text="draftText"
    :title="t('menu.translate')"
    :on-esc="isPickerMode ? handleOverlayEsc : undefined"
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
      <div
        v-if="isPickerMode"
        class="translate-picker"
        tabindex="-1"
        @keydown="onPickerKeyDown"
      >
        <div class="translate-columns">
          <!-- Source language column -->
          <div
            class="translate-column"
            :class="{ 'is-active': activeField === 'source' }"
            data-field="source"
            @mousedown="activateField('source')"
            @click="activateField('source')"
          >
            <div class="translate-column-header">
              <div v-if="!sourceQuery" class="translate-column-title-row">
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
              <div v-show="sourceQuery" class="translate-query-row">
                <AppIcon
                  icon="mdi:magnify"
                  size="sm"
                  class="translate-query-icon"
                />
              </div>

              <input
                ref="sourceInputRef"
                v-model="sourceQuery"
                type="text"
                class="translate-column-header-input"
                :class="{
                  'is-searching': Boolean(sourceQuery),
                  'is-idle': !sourceQuery,
                }"
                data-field="source"
                :disabled="isInputDisabled"
                :aria-label="t('menu.translateSourcePlaceholder')"
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
                @keydown="onInputKeyDown($event, 'source')"
              />

              <button
                v-if="sourceQuery"
                type="button"
                class="translate-query-clear-btn"
                :title="t('editor.clear')"
                @click.stop="clearQuery('source')"
              >
                <AppIcon icon="mdi:close" size="xs" />
              </button>
            </div>

            <ul
              v-if="sourceOptions.length > 0"
              id="translate-source-list"
              ref="sourceListRef"
              class="translate-column-options"
              role="listbox"
              @mousedown="activateField('source')"
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
                    <span class="translate-option-text">
                      {{ option.label
                      }}<span
                        v-if="option.hint"
                        class="translate-option-native"
                      >
                        · {{ option.hint }}</span
                      >
                    </span>
                  </span>
                  <span class="translate-option-end">
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

          <!-- Swap button between columns -->
          <div class="translate-swap-container">
            <button
              type="button"
              class="translate-swap-button"
              :disabled="isAutoSource || isInputDisabled"
              :title="`${t('menu.translateSwapLanguages')} (Ctrl+Shift+S)`"
              :aria-label="t('menu.translateSwapLanguages')"
              @click="swapLanguages"
            >
              <AppIcon icon="mdi:swap-horizontal" size="md" />
            </button>
          </div>

          <!-- Target language column -->
          <div
            class="translate-column"
            :class="{ 'is-active': activeField === 'target' }"
            data-field="target"
            @mousedown="activateField('target')"
            @click="activateField('target')"
          >
            <div class="translate-column-header">
              <div v-if="!targetQuery" class="translate-column-title-row">
                <span class="translate-column-label">{{
                  t('menu.translateTargetLanguage')
                }}</span>
                <span v-if="targetLanguage" class="translate-column-selected">
                  {{ targetLabel }}
                </span>
              </div>
              <div v-show="targetQuery" class="translate-query-row">
                <AppIcon
                  icon="mdi:magnify"
                  size="sm"
                  class="translate-query-icon"
                />
              </div>

              <input
                ref="targetInputRef"
                v-model="targetQuery"
                type="text"
                class="translate-column-header-input"
                :class="{
                  'is-searching': Boolean(targetQuery),
                  'is-idle': !targetQuery,
                }"
                data-field="target"
                :disabled="isInputDisabled"
                :aria-label="t('menu.translateTargetPlaceholder')"
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
                @keydown="onInputKeyDown($event, 'target')"
              />

              <button
                v-if="targetQuery"
                type="button"
                class="translate-query-clear-btn"
                :title="t('editor.clear')"
                @click.stop="clearQuery('target')"
              >
                <AppIcon icon="mdi:close" size="xs" />
              </button>
            </div>

            <ul
              v-if="targetOptions.length > 0"
              id="translate-target-list"
              ref="targetListRef"
              class="translate-column-options"
              role="listbox"
              @mousedown="activateField('target')"
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
                    <span class="translate-option-text">
                      {{ option.label
                      }}<span
                        v-if="option.hint"
                        class="translate-option-native"
                      >
                        · {{ option.hint }}</span
                      >
                    </span>
                  </span>
                  <span class="translate-option-end">
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
          <div class="translate-hints-secondary">
            <ShortcutHint
              :keys="['Tab']"
              interactive
              :disabled="props.shortcutsDisabled"
              @click="switchField"
            >
              {{ t('menu.translateSwitchField') }}
            </ShortcutHint>
          </div>
          <div class="translate-hints-primary">
            <ShortcutHint
              v-if="activeField === 'source'"
              :keys="['Ctrl', 'Enter']"
              interactive
              :disabled="props.shortcutsDisabled || isQuickTranslateDisabled"
              @click="quickTranslate('source')"
            >
              {{ t('menu.translate') }}
            </ShortcutHint>
            <ShortcutHint
              class="is-primary"
              :keys="['Enter']"
              interactive
              :disabled="
                props.shortcutsDisabled ||
                (activeField === 'source'
                  ? highlightedSourceIndex < 0
                  : highlightedTargetIndex < 0)
              "
              @click="
                activeField === 'source' ? submitSource() : submitTarget()
              "
            >
              {{
                activeField === 'source'
                  ? t('menu.translatePickSource')
                  : t('menu.translate')
              }}
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
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

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

onUnmounted(() => {
  if (menuModalsStore.pendingModal) {
    menuModalsStore.cancelPending()
  }
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
const targetLanguage = ref<string | undefined>(undefined)

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

const recentTargetLanguages = computed(
  () => desktopStore.sessionState?.recentTranslateLanguages ?? []
)
const recentSourceLanguages = computed(
  () => desktopStore.sessionState?.recentTranslateSourceLanguages ?? []
)

const recentFor = (direction: 'source' | 'target') => {
  const list =
    direction === 'source'
      ? recentSourceLanguages.value
      : recentTargetLanguages.value
  return list.flatMap(
    (id) => resolveTranslationLanguage(id, provider.value, direction) ?? []
  )
}

watch(provider, () => {
  sourceLanguage.value = AUTO_LANGUAGE_VALUE
  targetLanguage.value = undefined
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
    sourceLanguage.value = AUTO_LANGUAGE_VALUE
    isPickerMode.value = true
    await nextTick()
    targetInputRef.value?.focus()
  },
}

const closePicker = () => {
  isPickerMode.value = false
}

const handleOverlayEsc = () => {
  const currentQuery =
    activeField.value === 'source' ? sourceQuery : targetQuery
  if (currentQuery.value) {
    currentQuery.value = ''
  } else {
    closePicker()
  }
}

const clearQuery = (column: 'source' | 'target') => {
  if (column === 'source') {
    sourceQuery.value = ''
    activateField('source')
  } else {
    targetQuery.value = ''
    activateField('target')
  }
}

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
    hint:
      native && native.toLowerCase() !== label.toLowerCase()
        ? native
        : undefined,
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

const sourceOptions = computed<QueryPanelOption[]>(() => {
  const query = sourceQuery.value.trim()
  if (!query) return rawSourceOptions.value

  const autoOption = rawSourceOptions.value[0]!
  const otherOptions = rawSourceOptions.value.slice(1)
  const filtered = filterOptions(otherOptions, query).map((option) => ({
    ...option,
    group: undefined,
  }))
  return [autoOption, ...filtered]
})

const rawTargetOptions = computed<QueryPanelOption[]>(() =>
  groupLanguages(
    recentFor('target'),
    languageIds('target'),
    languageLabel,
    sourceLanguage.value === AUTO_LANGUAGE_VALUE
      ? undefined
      : sourceLanguage.value,
    locale.value
  ).map(({ id, group }) => toOption(id, group, id === targetLanguage.value))
)

const targetOptions = computed<QueryPanelOption[]>(() => {
  const query = targetQuery.value.trim()
  if (!query) return rawTargetOptions.value

  return filterOptions(rawTargetOptions.value, query).map((option) => ({
    ...option,
    group: undefined,
  }))
})

const isAutoSource = computed(
  () => sourceLanguage.value === AUTO_LANGUAGE_VALUE
)

const sourceLabel = computed(() =>
  isAutoSource.value
    ? t('menu.translateAutoDetect')
    : languageLabel(sourceLanguage.value)
)

const targetLabel = computed(() =>
  targetLanguage.value ? languageLabel(targetLanguage.value) : ''
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
    const selectedIndex = targetOptions.value.findIndex((o) => o.selected)
    highlightedTargetIndex.value = selectedIndex
  }
  if (highlightedTargetIndex.value >= 0) {
    scrollToHighlighted('target')
  }
})

watch(
  [sourceOptions, sourceLanguage],
  () => {
    if (sourceQuery.value.trim() !== '') {
      highlightedSourceIndex.value = sourceOptions.value.length > 1 ? 1 : 0
    } else {
      const selectedIndex = sourceOptions.value.findIndex((o) => o.selected)
      highlightedSourceIndex.value = selectedIndex >= 0 ? selectedIndex : 0
    }
    if (highlightedSourceIndex.value >= 0) {
      scrollToHighlighted('source')
    }
  },
  { immediate: true }
)

function activateField(field: 'source' | 'target') {
  activeField.value = field
  void nextTick(() => {
    if (field === 'source') {
      sourceInputRef.value?.focus()
    } else {
      targetInputRef.value?.focus()
    }
  })
}

function switchField() {
  if (activeField.value === 'source') {
    activateField('target')
  } else {
    activateField('source')
  }
}

function swapLanguages() {
  if (isAutoSource.value || isInputDisabled.value) return

  const currentSource = sourceLanguage.value
  const currentTarget =
    targetLanguage.value ??
    targetOptions.value[highlightedTargetIndex.value]?.id ??
    rawTargetOptions.value[0]?.id

  if (!currentTarget) return

  const newSource = resolveTranslationLanguage(
    currentTarget,
    provider.value,
    'source'
  )
  const newTarget = resolveTranslationLanguage(
    currentSource,
    provider.value,
    'target'
  )

  if (newSource && newTarget) {
    sourceLanguage.value = newSource
    targetLanguage.value = newTarget
    sourceQuery.value = ''
    targetQuery.value = ''
    void desktopStore.patchSessionState({
      recentTranslateLanguages: pushRecent(
        recentTargetLanguages.value,
        newTarget
      ),
      recentTranslateSourceLanguages: pushRecent(
        recentSourceLanguages.value,
        newSource
      ),
    })
  }
}

const isQuickTranslateDisabled = computed(() => {
  const hasTarget = Boolean(
    targetLanguage.value ||
    highlightedTargetIndex.value >= 0 ||
    targetOptions.value[0]?.id
  )
  return isInputDisabled.value || !hasTarget
})

function quickTranslate(fromColumn?: 'source' | 'target') {
  if (isInputDisabled.value) return

  const effectiveColumn = fromColumn ?? activeField.value
  let targetId = targetLanguage.value
  if (!targetId && highlightedTargetIndex.value >= 0) {
    targetId = targetOptions.value[highlightedTargetIndex.value]?.id
  }
  if (!targetId) {
    targetId = targetOptions.value[0]?.id
  }
  if (!targetId) return

  let sourceId = pickedSourceLanguage()
  if (effectiveColumn === 'source' && highlightedSourceIndex.value >= 0) {
    const chosen = sourceOptions.value[highlightedSourceIndex.value]
    if (chosen) {
      sourceLanguage.value = chosen.id
      sourceId = pickedSourceLanguage()
      if (chosen.id !== AUTO_LANGUAGE_VALUE) {
        void desktopStore.patchSessionState({
          recentTranslateSourceLanguages: pushRecent(
            recentSourceLanguages.value,
            chosen.id
          ),
        })
      }
    }
  }

  void desktopStore.patchSessionState({
    recentTranslateLanguages: pushRecent(recentTargetLanguages.value, targetId),
  })
  void translate(targetId, sourceId)
}

function submitSource(option?: QueryPanelOption) {
  if (isInputDisabled.value) return
  const chosen = option ?? sourceOptions.value[highlightedSourceIndex.value]
  if (!chosen) return

  sourceLanguage.value = chosen.id
  sourceQuery.value = ''
  if (chosen.id !== AUTO_LANGUAGE_VALUE) {
    void desktopStore.patchSessionState({
      recentTranslateSourceLanguages: pushRecent(
        recentSourceLanguages.value,
        chosen.id
      ),
    })
  }
  activateField('target')
}

async function submitTarget(option?: QueryPanelOption) {
  if (isInputDisabled.value) return
  const chosen = option ?? targetOptions.value[highlightedTargetIndex.value]
  if (!chosen) return

  targetLanguage.value = chosen.id
  targetQuery.value = ''
  void desktopStore.patchSessionState({
    recentTranslateLanguages: pushRecent(
      recentTargetLanguages.value,
      chosen.id
    ),
  })
  await translate(chosen.id, pickedSourceLanguage())
}

function handleNavigationKey(
  event: KeyboardEvent,
  column: 'source' | 'target'
) {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    (event.key === 'S' || event.key === 's')
  ) {
    event.preventDefault()
    swapLanguages()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    if (event.repeat) return
    quickTranslate(column)
    return
  }

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
      const query = column === 'source' ? sourceQuery : targetQuery
      if (query.value) {
        query.value = ''
      } else {
        closePicker()
      }
      return
    }
  }
}

function onInputKeyDown(event: KeyboardEvent, column: 'source' | 'target') {
  if (isInputDisabled.value || event.isComposing) return

  // Prevent leading space
  const query = column === 'source' ? sourceQuery.value : targetQuery.value
  if (event.key === ' ' && !query.trim()) {
    event.preventDefault()
    return
  }

  handleNavigationKey(event, column)
}

function onPickerKeyDown(event: KeyboardEvent) {
  if (isInputDisabled.value || event.isComposing) return
  // If event originated from an input, onInputKeyDown already handled it
  if (event.target instanceof HTMLInputElement) return

  handleNavigationKey(event, activeField.value)
}

/** The source language the user picked; undefined lets the translator detect it */
function pickedSourceLanguage(): string | undefined {
  return sourceLanguage.value === AUTO_LANGUAGE_VALUE
    ? undefined
    : sourceLanguage.value
}

const translate = async (targetLanguageCode: string, source?: string) => {
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

  if (source === targetLanguageCode) {
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
        operationConfig: {
          language: targetLanguageCode,
          sourceLanguage: source,
        },
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
  outline: none;
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
  cursor: default;
}

.translate-column-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 1.5rem;
  padding: 0 var(--space-2xs);
}

.translate-column-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  width: 100%;
  min-width: 0;
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

.translate-query-row {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.translate-query-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.translate-query-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

.translate-query-clear-btn:hover {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.translate-column-header-input {
  outline: none;
}

.translate-column-header-input.is-idle {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: default;
}

.translate-column-header-input.is-searching {
  flex: 1 1 auto;
  min-width: 0;
  height: 1.5rem;
  border: none;
  background: transparent;
  padding: 0 0 0 var(--space-2xs);
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--color-base-content);
}

.translate-swap-container {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding-top: 1.5rem;
}

.translate-swap-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-size-sm);
  height: var(--control-size-sm);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-full, 9999px);
  background-color: var(--app-surface-raised);
  color: var(--app-text-muted);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.translate-swap-button:hover:not(:disabled) {
  background-color: var(--app-hover);
  border-color: var(--app-border-focus);
  color: var(--color-primary);
}

.translate-swap-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.translate-column-options {
  display: flex;
  flex-direction: column;
  height: 12.5rem;
  margin: 0;
  padding: var(--space-xs);
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.translate-column.is-active .translate-column-options {
  border-color: var(--app-border-focus);
  box-shadow: var(--app-focus-ring);
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

.translate-option-native {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  font-weight: normal;
}

.translate-column.is-active
  .translate-option.is-highlighted
  .translate-option-native {
  color: var(--color-primary);
  opacity: 0.8;
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

.translate-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 12.5rem;
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

.translate-hints-secondary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.translate-hints-primary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
</style>
