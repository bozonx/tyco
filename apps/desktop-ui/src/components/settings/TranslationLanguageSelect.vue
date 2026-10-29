<template>
  <div ref="containerRef" class="relative w-full" @focusout="onFocusout">
    <button
      ref="triggerRef"
      type="button"
      v-bind="controlAttrs()"
      class="select text-left w-full cursor-pointer"
      :class="{ 'select--open': isOpen }"
      :data-size="size ?? 'md'"
      :disabled="disabled"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      :aria-controls="isOpen ? listboxId : undefined"
      @click="toggleDropdown"
      @keydown="onTriggerKeydown"
    >
      <span class="truncate block" :class="{ 'opacity-60': !selectedOption }">
        {{ displayLabel }}
      </span>
    </button>

    <Teleport to="body" :disabled="!canTeleport">
      <MenuSurface
        v-if="isOpen"
        ref="surfaceRef"
        :style="[
          panelStyle,
          {
            minWidth: panelMinWidth,
            maxWidth: 'min(28rem, calc(100vw - 1rem))',
          },
        ]"
        :data-theme="panelTheme"
        class="translation-language-panel"
        @focusout="onFocusout"
        @keydown="onPanelKeydown"
      >
        <div class="search-box">
          <SearchInput
            ref="searchFieldRef"
            v-model="query"
            size="sm"
            :placeholder="t('menu.translateTargetPlaceholder')"
          />
        </div>

        <div ref="listRef" role="listbox" :id="listboxId" class="options-list">
          <div v-if="visibleOptions.length === 0" class="empty-message">
            {{ t('menu.translateNoLanguage') }}
          </div>
          <button
            v-for="(option, index) in visibleOptions"
            :key="option.id"
            :id="`${listboxId}-option-${index}`"
            :data-index="index"
            type="button"
            role="option"
            class="language-option"
            :class="{
              'is-selected': option.id === selectedLanguage,
              'is-active': index === activeIndex,
            }"
            :aria-selected="option.id === selectedLanguage"
            :disabled="option.disabled"
            @click="pickLanguage(option.id)"
            @mousemove="activeIndex = index"
          >
            <AppIcon
              icon="mdi:check"
              size="sm"
              class="shrink-0 transition-opacity"
              :class="{ 'opacity-0': option.id !== selectedLanguage }"
            />
            <span class="language-option-label truncate">{{
              option.name
            }}</span>
          </button>
        </div>
      </MenuSurface>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch, watchEffect } from 'vue'

import { useAnchoredPanel } from '../../composables/use-anchored-panel'
import { useFieldControl } from '../../composables/use-field-control'
import { useI18n } from '../../composables/use-i18n'
import { usePopover } from '../../composables/use-popover'
import { filterOptions, moveHighlight } from '../../lib/menu-query/menu-query'
import {
  type TranslationProvider,
  resolveTranslationLanguage,
  translationLanguageLabel,
  translationLanguageOptions,
  translationLanguageSearchNames,
} from '../../lib/translation/translation-languages'
import type { ControlSize } from '../../lib/ui/control-types'
import { focusAfterTrigger } from '../../lib/ui/focus-navigation'
import AppIcon from '../common/AppIcon.vue'
import MenuSurface from '../common/MenuSurface.vue'
import SearchInput from '../common/SearchInput.vue'

interface LanguageOption {
  id: string
  name: string
  label: string
  keywords: string[]
  disabled?: boolean
}

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue?: string | null
  provider: TranslationProvider
  preferredLanguages?: string[]
  placeholder?: string
  size?: ControlSize
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const rawControlAttrs = useFieldControl()
const controlAttrs = () => {
  const { type: _type, ...attrs } = rawControlAttrs()
  return attrs
}

const { t, locale } = useI18n()
const listboxId = useId()
const query = ref('')
const activeIndex = ref(0)
const searchFieldRef = ref<{ focus: () => void } | null>(null)
const listRef = ref<HTMLElement | null>(null)

const { isOpen, containerRef, triggerRef, panelRef, close, onFocusout } =
  usePopover()

const surfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
watchEffect(() => {
  panelRef.value = surfaceRef.value?.element ?? null
})

const canTeleport = computed(() => !containerRef.value?.closest('dialog'))

const {
  style: panelStyle,
  theme: panelTheme,
  updatePosition,
} = useAnchoredPanel({
  isOpen: () => isOpen.value,
  anchor: () => triggerRef.value as HTMLElement | null,
  panel: () => panelRef.value,
  placement: () => 'bottom',
  align: () => 'start',
})

const panelMinWidth = computed(() => {
  const width =
    (triggerRef.value as HTMLElement | null)?.getBoundingClientRect().width ?? 0
  return `${Math.max(width, 240)}px`
})

const selectedLanguage = computed(() =>
  props.modelValue
    ? (resolveTranslationLanguage(props.modelValue, props.provider, 'target') ??
      props.modelValue)
    : ''
)

const options = computed<LanguageOption[]>(() => {
  const preferred = new Set(
    (props.preferredLanguages ?? []).flatMap(
      (id) => resolveTranslationLanguage(id, props.provider, 'target') ?? []
    )
  )
  return translationLanguageOptions(props.provider, locale.value)
    .map(({ id, name }) => ({
      id,
      name: `${name} (${id})`,
      label: name,
      keywords: translationLanguageSearchNames(id),
    }))
    .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)))
})

const selectedOption = computed(() => {
  if (!selectedLanguage.value) return undefined
  const found = options.value.find(({ id }) => id === selectedLanguage.value)
  if (found) return found
  return {
    id: selectedLanguage.value,
    name: `${translationLanguageLabel(selectedLanguage.value, locale.value)} (${t('settings.translationLanguageUnavailable')})`,
    label: '',
    keywords: [],
    disabled: true,
  }
})

const displayLabel = computed(() => {
  if (selectedOption.value) return selectedOption.value.name
  return props.placeholder || t('commands.languagePlaceholder')
})

const visibleOptions = computed(() => {
  const filtered = filterOptions(options.value, query.value).slice(0, 100)
  if (query.value.trim()) return filtered
  const selected = options.value.find(({ id }) => id === selectedLanguage.value)
  if (selected && !filtered.includes(selected)) filtered.unshift(selected)
  if (selectedLanguage.value && !selected)
    filtered.unshift(selectedOption.value!)
  return props.placeholder
    ? [
        {
          id: '',
          name: props.placeholder,
          label: props.placeholder,
          keywords: [],
        },
        ...filtered,
      ]
    : filtered
})

function scrollToActiveOption() {
  void nextTick(() => {
    const el = listRef.value?.querySelector(
      `[data-index="${activeIndex.value}"]`
    )
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}

async function openDropdown() {
  if (props.disabled) return
  isOpen.value = true
  query.value = ''
  const selectedIndex = visibleOptions.value.findIndex(
    (opt) => opt.id === selectedLanguage.value
  )
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : 0
  await nextTick()
  panelRef.value = surfaceRef.value?.element ?? null
  updatePosition()
  await nextTick()
  searchFieldRef.value?.focus()
  scrollToActiveOption()
}

function toggleDropdown() {
  if (props.disabled) return
  if (isOpen.value) {
    close(true)
  } else {
    void openDropdown()
  }
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (!isOpen.value) {
      void openDropdown()
    }
  }
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (visibleOptions.value.length === 0) return
    activeIndex.value = moveHighlight(
      activeIndex.value,
      1,
      visibleOptions.value.length
    )
    scrollToActiveOption()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (visibleOptions.value.length === 0) return
    activeIndex.value = moveHighlight(
      activeIndex.value,
      -1,
      visibleOptions.value.length
    )
    scrollToActiveOption()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const active = visibleOptions.value[activeIndex.value]
    if (active && !active.disabled) {
      pickLanguage(active.id)
    } else {
      const firstValid = visibleOptions.value.find((opt) => !opt.disabled)
      if (firstValid) pickLanguage(firstValid.id)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const trigger = triggerRef.value as HTMLElement | null
    if (event.shiftKey) {
      close(true)
    } else {
      if (trigger) focusAfterTrigger(trigger, panelRef.value)
      close()
    }
  }
}

function pickLanguage(value: string | number | undefined) {
  if (typeof value !== 'string') return
  emit('update:modelValue', value)
  query.value = ''
  close(true)
}

watch(query, () => {
  activeIndex.value = 0
  if (listRef.value) listRef.value.scrollTop = 0
})

watch(
  () => props.provider,
  () => {
    query.value = ''
  }
)

defineExpose({ focus: () => (triggerRef.value as HTMLElement | null)?.focus() })
</script>

<style scoped>
.select--open {
  border-color: var(--color-primary);
  box-shadow: var(--app-focus-ring);
}

.translation-language-panel {
  padding: 0;
  overflow: hidden;
  width: max-content;
  max-width: min(28rem, calc(100vw - 1rem));
}

.search-box {
  padding: var(--space-xs);
  border-bottom: 1px solid var(--app-border-subtle);
}

.options-list {
  max-height: 15rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-xs);
}

.empty-message {
  padding: var(--space-md);
  text-align: center;
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}

.language-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.375rem var(--space-sm);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-base-content);
  font-size: var(--text-control);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.language-option:hover:not(:disabled),
.language-option.is-active:not(:disabled) {
  background-color: var(--app-hover);
}

.language-option.is-selected {
  font-weight: 500;
}

.language-option:disabled {
  color: var(--app-text-faint);
  cursor: not-allowed;
}

.language-option-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
