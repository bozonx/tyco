<template>
  <button
    ref="buttonRef"
    type="button"
    class="input hotkey-input"
    :class="{
      'is-recording': recording,
      'is-invalid': recording && invalid,
      'is-saved': saved,
    }"
    :aria-label="ariaLabel"
    :aria-pressed="recording"
    @click="start"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @blur="stop"
  >
    <span v-if="recording && heldKeys.length === 0" class="hotkey-prompt">
      <span class="hotkey-dot" aria-hidden="true" />
      {{ t('settings.hotkeyInput.recording') }}
    </span>
    <span v-else-if="displayKeys.length > 0" class="hotkey-keys">
      <template v-for="(key, index) in displayKeys" :key="index">
        <span v-if="index > 0" class="hotkey-plus">+</span>
        <KeyButton>{{ key }}</KeyButton>
      </template>
      <span v-if="recording && !invalid" class="hotkey-plus">+ …</span>
    </span>
    <span v-else class="hotkey-placeholder">{{ placeholder }}</span>

    <span v-if="recording" class="hotkey-hint">
      {{
        invalid
          ? t('settings.hotkeyInput.needsModifier')
          : t('settings.hotkeyInput.cancelHint')
      }}
    </span>
    <Icon
      v-else-if="saved"
      icon="mdi:check-circle"
      height="16"
      class="hotkey-saved-icon"
    />
    <Icon
      v-else
      icon="mdi:keyboard-outline"
      height="16"
      class="hotkey-edit-icon"
    />
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  heldModifiers,
  recordKeyDown,
  shortcutKeys,
} from '../../lib/hotkeys/hotkey-recorder'
import KeyButton from './KeyButton.vue'
import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{ value: string; ariaLabel?: string; placeholder?: string }>(),
  { ariaLabel: undefined, placeholder: '' }
)
const emit = defineEmits<{ (event: 'record', shortcut: string): void }>()
const { t } = useI18n()

const SAVED_FLASH_MS = 1500

const buttonRef = ref<HTMLButtonElement | null>(null)
const recording = ref(false)
const heldKeys = ref<string[]>([])
const invalid = ref(false)
const saved = ref(false)
let recorded: string | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null

const displayKeys = computed(() =>
  recording.value ? heldKeys.value : shortcutKeys(props.value)
)

function start() {
  if (recording.value) return
  recording.value = true
  heldKeys.value = []
  invalid.value = false
  saved.value = false
}

function stop() {
  recording.value = false
  heldKeys.value = []
  invalid.value = false
}

function flashSaved() {
  if (savedTimer) clearTimeout(savedTimer)
  saved.value = true
  savedTimer = setTimeout(() => (saved.value = false), SAVED_FLASH_MS)
}

function onKeyDown(event: KeyboardEvent) {
  if (!recording.value) return
  event.preventDefault()
  event.stopPropagation()
  const step = recordKeyDown(event)
  switch (step.kind) {
    case 'cancel':
      buttonRef.value?.blur()
      return
    case 'pending':
      heldKeys.value = step.keys
      invalid.value = false
      return
    case 'invalid':
      heldKeys.value = step.keys
      invalid.value = true
      return
    case 'done':
      recorded = step.shortcut
      buttonRef.value?.blur()
      if (step.shortcut === props.value) flashSaved()
      else emit('record', step.shortcut)
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (!recording.value || invalid.value) return
  heldKeys.value = heldModifiers(event)
}

// the parent may reject a shortcut, so only a value that came back confirms it
watch(
  () => props.value,
  (value) => {
    if (recorded && value === recorded) flashSaved()
    recorded = null
  }
)

onBeforeUnmount(() => {
  if (savedTimer) clearTimeout(savedTimer)
})
</script>

<style scoped>
.hotkey-input {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 12rem;
  cursor: pointer;
  text-align: left;
}

.hotkey-keys {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.hotkey-plus {
  color: var(--app-text-faint);
  font-size: 0.75rem;
}

.hotkey-placeholder {
  color: var(--app-text-faint);
}

.hotkey-prompt {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-primary);
}

.hotkey-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-primary);
  animation: hotkey-pulse 1.2s ease-in-out infinite;
}

.hotkey-hint {
  margin-left: auto;
  color: var(--app-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.hotkey-edit-icon,
.hotkey-saved-icon {
  flex-shrink: 0;
  margin-left: auto;
}

.hotkey-edit-icon {
  color: var(--app-text-faint);
}

.hotkey-saved-icon {
  color: var(--color-success);
}

.hotkey-input.is-recording {
  border-color: var(--color-primary);
  box-shadow: var(--app-focus-ring);
  background-color: color-mix(
    in oklab,
    var(--color-primary) 6%,
    var(--app-surface)
  );
}

.hotkey-input.is-invalid {
  border-color: var(--app-error);
}

.hotkey-input.is-invalid .hotkey-hint {
  color: var(--app-error);
}

.hotkey-input.is-saved {
  border-color: var(--color-success);
}

@keyframes hotkey-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}
</style>
