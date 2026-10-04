<template>
  <!-- keyup.esc stops here: the window's own Esc handling must not close the menu -->
  <div class="query-panel" @keyup.esc.prevent.stop="emit('back')">
    <div class="query-panel-head">
      <slot name="before-input" />
      <input
        ref="inputRef"
        class="query-panel-input"
        type="text"
        :value="props.modelValue"
        :placeholder="props.placeholder"
        :aria-label="props.placeholder"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="props.options.length > 0"
        :aria-activedescendant="
          highlighted >= 0 ? `query-option-${highlighted}` : undefined
        "
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
        @keydown="onKeyDown"
      />
    </div>

    <ul
      v-if="props.options.length > 0"
      class="query-panel-options"
      role="listbox"
    >
      <li
        v-for="(option, index) in props.options"
        :id="`query-option-${index}`"
        :key="option.id"
        role="option"
        class="query-panel-option"
        :class="{ 'is-highlighted': index === highlighted }"
        :aria-selected="index === highlighted"
        @mouseenter="highlighted = index"
        @mousedown.prevent
        @click="emit('submit', { option, ctrl: false })"
      >
        <span class="query-panel-option-label">{{ option.label }}</span>
        <span v-if="option.hint" class="query-panel-option-hint">{{
          option.hint
        }}</span>
      </li>
    </ul>
    <p v-else-if="props.emptyText" class="query-panel-empty">
      {{ props.emptyText }}
    </p>

    <div class="query-panel-hints">
      <button
        v-for="hint in props.hints"
        :key="hint.keys.join('+')"
        type="button"
        class="query-panel-hint"
        :disabled="hint.disabled"
        @mousedown.prevent
        @click="hint.action?.()"
      >
        <KeyButton v-for="key in hint.keys" :key="key">{{ key }}</KeyButton>
        <span>{{ hint.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import {
  type QueryOption,
  moveHighlight,
} from '../../lib/menu-query/menu-query'
import KeyButton from '../common/KeyButton.vue'

export interface QueryPanelOption extends QueryOption {
  /** Shown on the right of the label */
  hint?: string
}

export interface QueryPanelHint {
  keys: string[]
  label: string
  disabled?: boolean
  action?: () => void
}

export interface QueryPanelSubmit {
  /** The highlighted option, if any */
  option?: QueryPanelOption
  /** Ctrl (Cmd) was held with Enter */
  ctrl: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    options?: QueryPanelOption[]
    hints?: QueryPanelHint[]
    /**
     * The first option is highlighted as the list changes, so Enter picks it.
     * Otherwise nothing is, and Enter submits the typed text.
     */
    autoHighlight?: boolean
    emptyText?: string
  }>(),
  {
    placeholder: '',
    options: () => [],
    hints: () => [],
    autoHighlight: false,
    emptyText: '',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit', value: QueryPanelSubmit): void
  (e: 'back'): void
  (e: 'tab'): void
  (e: 'save'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const highlighted = ref(-1)

const resetHighlight = () => {
  highlighted.value = props.autoHighlight && props.options.length > 0 ? 0 : -1
}

watch(() => props.options, resetHighlight, { immediate: true })

const focus = () => inputRef.value?.focus()

const onInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const scrollToHighlighted = () => {
  void nextTick(() =>
    document
      .getElementById(`query-option-${highlighted.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  )
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing) return

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      highlighted.value = moveHighlight(
        highlighted.value,
        event.key === 'ArrowDown' ? 1 : -1,
        props.options.length
      )
      scrollToHighlighted()
      return
    case 'Enter':
      event.preventDefault()
      if (event.repeat) return
      emit('submit', {
        option: props.options[highlighted.value],
        ctrl: event.ctrlKey || event.metaKey,
      })
      return
    case 'Tab':
      event.preventDefault()
      emit('tab')
      return
    case 'Escape':
      // acted on at keyup, like the shortcut lists
      event.preventDefault()
      return
    default:
      if (
        (event.ctrlKey || event.metaKey) &&
        event.code === 'KeyS' &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault()
        emit('save')
      }
  }
}

onMounted(focus)

defineExpose({ focus })
</script>

<style scoped>
.query-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
}

.query-panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.query-panel-input {
  flex: 1;
  min-width: 0;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 55%, transparent);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  color: var(--color-base-content);
  font-size: 0.9375rem;
  outline: none;
}

.query-panel-input:focus {
  box-shadow: 0 0 0 3px
    color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.query-panel-options {
  display: flex;
  flex-direction: column;
  max-height: 9.5rem;
  margin: 0;
  padding: 0.25rem;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
}

.query-panel-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 1.875rem;
  padding: 0 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  cursor: pointer;
}

.query-panel-option.is-highlighted {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.query-panel-option-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.query-panel-option-hint {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--app-text-faint);
}

.query-panel-empty {
  margin: 0;
  padding: 0.5rem;
  font-size: 0.8125rem;
  color: var(--app-text-muted);
}

.query-panel-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-md);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
}

.query-panel-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
}

.query-panel-hint:hover:not(:disabled) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

.query-panel-hint:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
