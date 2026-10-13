<template>
  <!-- keyup.esc stops here: the window's own Esc handling must not close the menu -->
  <div
    class="query-panel"
    :inert="props.disabled"
    @keyup.esc.prevent.stop="emit('back')"
  >
    <div class="query-panel-head">
      <slot name="before-input" />
      <label class="query-panel-field">
        <span v-if="props.label" class="query-panel-label">{{
          props.label
        }}</span>
        <input
          ref="inputRef"
          class="query-panel-input"
          type="text"
          :disabled="props.disabled"
          :value="props.modelValue"
          :placeholder="props.placeholder"
          :aria-label="props.placeholder"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="props.options.length > 0"
          :aria-controls="props.options.length ? listboxId : undefined"
          :aria-activedescendant="
            highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
          "
          spellcheck="false"
          autocomplete="off"
          @input="onInput"
          @keydown="onKeyDown"
        />
      </label>
      <slot name="after-input" />
    </div>

    <ul
      v-if="props.options.length > 0"
      class="query-panel-options"
      role="listbox"
      :id="listboxId"
    >
      <template v-for="(option, index) in props.options" :key="option.id">
        <li
          v-if="
            option.group && option.group !== props.options[index - 1]?.group
          "
          class="query-panel-group"
          role="presentation"
        >
          {{ option.group }}
        </li>
        <li
          :id="`${listboxId}-option-${index}`"
          role="option"
          class="query-panel-option"
          :class="{
            'is-highlighted': index === highlighted,
            'is-selected': option.selected,
          }"
          :aria-selected="index === highlighted"
          @mouseenter="highlighted = index"
          @mousedown.prevent
          @click="emit('submit', { option, ctrl: false })"
        >
          <span class="query-panel-option-label">
            <Icon
              v-if="option.icon"
              :icon="option.icon"
              height="16"
              class="query-panel-option-icon"
            />
            <span class="query-panel-option-text">{{ option.label }}</span>
          </span>
          <span class="query-panel-option-end">
            <span v-if="option.hint" class="query-panel-option-hint">{{
              option.hint
            }}</span>
            <Icon
              v-if="option.selected"
              icon="mdi:check"
              height="16"
              class="query-panel-option-check"
            />
          </span>
        </li>
      </template>
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
        :disabled="
          props.disabled ||
          hint.disabled ||
          (hint.requireOption && highlighted < 0)
        "
        @mousedown.prevent
        @click="activateHint(hint)"
      >
        <KeyButton v-for="key in hint.keys" :key="key">{{ key }}</KeyButton>
        <span>{{ hint.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue'

import {
  type QueryOption,
  moveHighlight,
} from '../../lib/menu-query/menu-query'
import Icon from '../common/AppIcon.vue'
import KeyButton from '../common/KeyButton.vue'

export interface QueryPanelOption extends QueryOption {
  /** Shown on the right of the label */
  hint?: string
  /** Shown before the label */
  icon?: string
  /** A heading is shown above the first option of each run of the same group */
  group?: string
  /** The current value: marked, and highlighted as the list changes */
  selected?: boolean
}

export interface QueryPanelHint {
  keys: string[]
  label: string
  disabled?: boolean
  requireOption?: boolean
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
    /** A caption above the input */
    label?: string
    options?: QueryPanelOption[]
    hints?: QueryPanelHint[]
    /**
     * The first option is highlighted as the list changes, so Enter picks it.
     * Otherwise only a selected one is, and Enter submits the typed text.
     */
    autoHighlight?: boolean
    emptyText?: string
    disabled?: boolean
  }>(),
  {
    placeholder: '',
    label: '',
    options: () => [],
    hints: () => [],
    autoHighlight: false,
    emptyText: '',
    disabled: false,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'submit', value: QueryPanelSubmit): void
  (e: 'back'): void
  (e: 'save'): void
}>()

const listboxId = useId()
const inputRef = ref<HTMLInputElement | null>(null)
const highlighted = ref(-1)

const resetHighlight = () => {
  const selected = props.options.findIndex((option) => option.selected)
  highlighted.value =
    selected >= 0
      ? selected
      : props.autoHighlight && props.options.length
        ? 0
        : -1
  if (highlighted.value >= 0) scrollToHighlighted()
}

watch(() => props.options, resetHighlight, { immediate: true })

const focus = () => inputRef.value?.focus()
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) void nextTick(focus)
  }
)

const onInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function submit(ctrl = false) {
  emit('submit', { option: props.options[highlighted.value], ctrl })
}

function activateHint(hint: QueryPanelHint) {
  if (hint.action) hint.action()
  else if (hint.keys.includes('Enter')) {
    submit(hint.keys.includes('Ctrl') || hint.keys.includes('Cmd'))
  }
}

function scrollToHighlighted() {
  void nextTick(() =>
    document
      .getElementById(`${listboxId}-option-${highlighted.value}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  )
}

const onKeyDown = (event: KeyboardEvent) => {
  if (props.disabled || event.isComposing) return

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
      submit(event.ctrlKey || event.metaKey)
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
  align-items: flex-end;
  gap: var(--space-xs);
}

.query-panel-field {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.query-panel-label {
  padding-left: 0.125rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.query-panel-input {
  width: 100%;
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
  font-size: var(--text-body);
  cursor: pointer;
}

.query-panel-option.is-highlighted {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.query-panel-group {
  padding: 0.375rem 0.5rem 0.125rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.query-panel-group:first-child {
  padding-top: 0.125rem;
}

.query-panel-option.is-selected {
  font-weight: 600;
}

.query-panel-option-label {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.query-panel-option-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.query-panel-option-icon {
  flex-shrink: 0;
}

.query-panel-option-end {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
}

.query-panel-option-check {
  color: var(--color-primary);
}

.query-panel-option-hint {
  flex-shrink: 0;
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}

.query-panel-empty {
  margin: 0;
  padding: 0.5rem;
  font-size: var(--text-control);
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
  font-size: var(--text-control);
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
