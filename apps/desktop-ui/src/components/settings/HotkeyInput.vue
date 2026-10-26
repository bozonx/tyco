<template>
  <button
    v-bind="controlAttrs()"
    ref="buttonRef"
    type="button"
    class="input hotkey-input"
    :class="{
      'is-recording': isRecording,
      'is-invalid': isRecording && isInvalid,
      'is-saved': isSaved,
      'is-readonly': readonly,
    }"
    :aria-label="ariaLabel"
    :aria-pressed="readonly ? undefined : isRecording"
    :aria-readonly="readonly || undefined"
    @click="start"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @blur="stop"
  >
    <span
      v-if="isRecording && heldKeys.length === 0"
      class="hotkey-main hotkey-prompt"
    >
      <span class="hotkey-dot" aria-hidden="true" />
      <span class="hotkey-text">{{ t('settings.hotkeyInput.recording') }}</span>
    </span>
    <span v-else-if="displayGroups.length > 0" class="hotkey-main hotkey-keys">
      <template v-for="(keys, group) in displayGroups" :key="group">
        <span v-if="group > 0" class="hotkey-separator">,</span>
        <template v-for="(key, index) in keys" :key="index">
          <span v-if="index > 0" class="hotkey-plus">+</span>
          <KeyboardKey>{{ key }}</KeyboardKey>
        </template>
      </template>
      <span v-if="isRecording && !isInvalid" class="hotkey-plus">+ …</span>
    </span>
    <span v-else class="hotkey-main hotkey-placeholder">
      <span class="hotkey-text">{{ placeholder }}</span>
    </span>

    <span v-if="isRecording" class="hotkey-hint">
      {{
        isInvalid
          ? t('settings.hotkeyInput.needsModifier')
          : t('settings.hotkeyInput.cancelHint')
      }}
    </span>
    <AppIcon
      v-else-if="isSaved"
      icon="mdi:check-circle"
      size="md"
      class="hotkey-saved-icon"
    />
    <AppIcon
      v-else-if="!readonly"
      icon="mdi:keyboard-outline"
      size="md"
      class="hotkey-edit-icon"
    />
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import { useI18n } from '../../composables/use-i18n'
import {
  heldModifiers,
  keyLabelFor,
  recordKeyDown,
  shortcutAlternatives,
  shortcutKeys,
} from '../../lib/hotkeys/hotkey-recorder'
import AppIcon from '../common/AppIcon.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import type { HotkeyPlatform } from '@tyco/shared'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()
const props = withDefaults(
  defineProps<{
    modelValue: string
    ariaLabel?: string
    placeholder?: string
    /** Shows a shortcut that is changed elsewhere, e.g. by the desktop */
    readonly?: boolean
    /** Names the keys the way the platform does */
    platform?: HotkeyPlatform
  }>(),
  { ariaLabel: undefined, placeholder: '', readonly: false, platform: 'linux' }
)
const emit = defineEmits<{
  (event: 'update:modelValue', shortcut: string): void
  (event: 'recording', active: boolean): void
}>()
const { t } = useI18n()

const SAVED_FLASH_MS = 1500

const buttonRef = ref<HTMLButtonElement | null>(null)
const isRecording = ref(false)
const heldKeys = ref<string[]>([])
const isInvalid = ref(false)
const isSaved = ref(false)
let recorded: string | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null

/** The keys to show, one group per alternative shortcut. */
const displayGroups = computed(() =>
  (isRecording.value
    ? [heldKeys.value]
    : shortcutAlternatives(props.modelValue).map(shortcutKeys)
  )
    .filter((keys) => keys.length > 0)
    .map((keys) => keys.map((key) => keyLabelFor(key, props.platform)))
)

function start() {
  if (isRecording.value || props.readonly) return
  isRecording.value = true
  heldKeys.value = []
  isInvalid.value = false
  isSaved.value = false
  emit('recording', true)
}

function stop() {
  if (!isRecording.value) return
  isRecording.value = false
  heldKeys.value = []
  isInvalid.value = false
  emit('recording', false)
}

function flashSaved() {
  if (savedTimer) clearTimeout(savedTimer)
  isSaved.value = true
  savedTimer = setTimeout(() => (isSaved.value = false), SAVED_FLASH_MS)
}

function onKeyDown(event: KeyboardEvent) {
  if (!isRecording.value) return
  event.preventDefault()
  event.stopPropagation()
  const step = recordKeyDown(event, props.platform)
  switch (step.kind) {
    case 'cancel':
      buttonRef.value?.blur()
      return
    case 'pending':
      heldKeys.value = step.keys
      isInvalid.value = false
      return
    case 'invalid':
      heldKeys.value = step.keys
      isInvalid.value = true
      return
    case 'done':
      recorded = step.shortcut
      buttonRef.value?.blur()
      if (step.shortcut === props.modelValue) flashSaved()
      else emit('update:modelValue', step.shortcut)
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (!isRecording.value || isInvalid.value) return
  heldKeys.value = heldModifiers(event)
}

// the parent may reject a shortcut, so only a value that came back confirms it
watch(
  () => props.modelValue,
  (value) => {
    if (recorded && value === recorded) flashSaved()
    recorded = null
  }
)

onBeforeUnmount(() => {
  if (savedTimer) clearTimeout(savedTimer)
  stop()
})
</script>

<style scoped>
.hotkey-input {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 12rem;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
}

.hotkey-input.is-readonly {
  cursor: default;
}

.hotkey-main {
  display: inline-flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.hotkey-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hotkey-keys {
  gap: 0.25rem;
}

.hotkey-plus {
  color: var(--app-text-faint);
  font-size: var(--text-caption);
}

.hotkey-separator {
  margin-right: 0.25rem;
  color: var(--app-text-faint);
}

.hotkey-placeholder {
  color: var(--app-text-faint);
}

.hotkey-prompt {
  gap: var(--space-sm);
  color: var(--color-primary);
}

.hotkey-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-primary);
  animation: hotkey-pulse 1.2s ease-in-out infinite;
}

.hotkey-hint {
  flex-shrink: 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  white-space: nowrap;
}

.hotkey-edit-icon,
.hotkey-saved-icon {
  flex-shrink: 0;
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
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
