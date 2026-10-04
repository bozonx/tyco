<template>
  <ActionOverlayLayout
    :title="title"
    :onEsc="stage.kind === 'prepare' ? launcher.back : undefined"
    :escMode="stage.kind === 'prepare' ? 'back' : 'auto'"
  >
    <template v-if="stage.kind === 'list' && hasSelection" #header-extra>
      <span class="launcher-selection" :title="selectedText">
        <Icon icon="mdi:format-quote-open" height="14" />
        {{ t('commandLauncher.selection', { count: selectedText.length }) }}
      </span>
    </template>

    <template #preview>
      <div v-if="stage.kind === 'list'" class="launcher-list-stage">
        <div class="launcher-search">
          <Icon icon="mdi:magnify" height="18" class="launcher-search-icon" />
          <input
            ref="searchRef"
            class="launcher-search-input"
            type="text"
            :value="launcher.query"
            :placeholder="t('commandLauncher.searchPlaceholder')"
            :aria-label="t('commandLauncher.searchPlaceholder')"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="launcher-commands"
            :aria-expanded="launcher.visible.length > 0"
            :aria-activedescendant="
              launcher.visible.length
                ? `launcher-command-${launcher.highlighted}`
                : undefined
            "
            spellcheck="false"
            autocomplete="off"
            @input="
              launcher.setQuery(($event.target as HTMLInputElement).value)
            "
            @keydown="onSearchKeyDown"
          />
        </div>

        <ul
          v-if="launcher.visible.length"
          id="launcher-commands"
          class="launcher-commands"
          role="listbox"
        >
          <li
            v-for="(command, index) in launcher.visible"
            :id="`launcher-command-${index}`"
            :key="command.id"
            role="option"
            class="launcher-command"
            :class="{ 'is-highlighted': index === launcher.highlighted }"
            :aria-selected="index === launcher.highlighted"
            @mouseenter="launcher.highlighted = index"
            @mousedown.prevent
            @click="void launcher.pick(command)"
          >
            <KeyButton v-if="index < LAUNCHER_KEY_COUNT" class="launcher-key">
              {{ index + 1 }}
            </KeyButton>
            <span v-else class="launcher-key" />
            <Icon
              :icon="commandIcon(command)"
              height="18"
              class="launcher-command-icon"
            />
            <span class="launcher-command-text">
              <span class="launcher-command-name">
                {{ commandLabel(command) }}
              </span>
              <span v-if="command.description" class="launcher-command-desc">
                {{ command.description }}
              </span>
            </span>
            <Icon
              v-if="commandTakesText(command)"
              icon="mdi:text"
              height="16"
              class="launcher-command-flag"
              :title="t('commandLauncher.takesText')"
            />
            <Icon
              v-if="command.confirm === 'always'"
              icon="mdi:shield-check-outline"
              height="16"
              class="launcher-command-flag"
              :title="t('commandLauncher.asksConfirm')"
            />
          </li>
        </ul>
        <p v-else-if="launcher.commands.length" class="launcher-empty">
          {{ t('commandLauncher.nothingFound') }}
        </p>
        <p v-else class="launcher-empty">
          {{ t('commandLauncher.noCommands') }}
        </p>
      </div>

      <div v-else-if="stage.kind === 'prepare'" class="launcher-prepare">
        <div class="launcher-prepare-head">
          <Icon :icon="commandIcon(stage.command)" height="20" />
          <span class="launcher-prepare-name">
            {{ commandLabel(stage.command) }}
          </span>
        </div>
        <p v-if="stage.command.description" class="launcher-command-desc">
          {{ stage.command.description }}
        </p>
        <code
          v-if="target"
          class="launcher-target"
          :title="t('commandLauncher.targetHint')"
        >
          {{ target }}
        </code>
        <textarea
          v-if="commandTakesText(stage.command)"
          ref="textRef"
          class="launcher-text"
          :value="launcher.text"
          :placeholder="t('commandLauncher.textPlaceholder')"
          :aria-label="t('commandLauncher.textPlaceholder')"
          @input="
            launcher.setText(($event.target as HTMLTextAreaElement).value)
          "
          @keydown="onTextKeyDown"
        />
        <p v-else class="launcher-confirm">
          {{ t('commandLauncher.confirmRun') }}
        </p>
      </div>

      <InProgressMessage
        v-else
        :label="
          t('commandLauncher.running', { name: commandLabel(stage.command) })
        "
        :onCancel="launcher.cancel"
      />
    </template>

    <template #actions>
      <div class="launcher-hints">
        <template v-if="stage.kind === 'list'">
          <span class="launcher-hint">
            <KeyButton>1</KeyButton>–<KeyButton>9</KeyButton>
            {{ t('commandLauncher.hintRun') }}
          </span>
          <span class="launcher-hint">
            <KeyButton>↑</KeyButton><KeyButton>↓</KeyButton>
            {{ t('commandLauncher.hintSelect') }}
          </span>
          <button
            type="button"
            class="launcher-hint"
            :disabled="!launcher.visible.length"
            @mousedown.prevent
            @click="void launcher.pickHighlighted()"
          >
            <KeyButton>Enter</KeyButton>
            {{ t('commandLauncher.hintRun') }}
          </button>
        </template>
        <template v-else-if="stage.kind === 'prepare'">
          <button
            type="button"
            class="launcher-hint"
            :disabled="!launcher.canSubmit"
            @mousedown.prevent
            @click="void launcher.submit()"
          >
            <KeyButton>Enter</KeyButton>
            {{ t('commandLauncher.hintRun') }}
          </button>
          <span v-if="commandTakesText(stage.command)" class="launcher-hint">
            <KeyButton>Shift</KeyButton><KeyButton>Enter</KeyButton>
            {{ t('commandLauncher.hintNewLine') }}
          </span>
        </template>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useOverlayNav } from '../../composables/useOverlayNav'
import { LAUNCHER_KEY_COUNT } from '../../lib/command-launcher/launcher-model'
import {
  commandIcon,
  commandLabel,
  commandTakesText,
  commandTarget,
} from '../../lib/commands/command-config'
import { useCommandLauncherStore } from '../../stores/commandLauncher'
import { useIpcStore } from '../../stores/ipc'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import KeyButton from '../common/KeyButton.vue'
import InProgressMessage from './InProgressMessage.vue'
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{ stopListening?: boolean }>(), {
  stopListening: false,
})

const { t } = useI18n()
const ipcStore = useIpcStore()
const launcher = useCommandLauncherStore()

const stage = computed(() => launcher.stage)
const selectedText = computed(() => ipcStore.params.selectedText ?? '')
const hasSelection = computed(() => Boolean(selectedText.value.trim()))

/** What the prepared command runs, so the user knows before confirming */
const target = computed(() =>
  stage.value.kind === 'prepare'
    ? commandTarget(stage.value.command).trim()
    : ''
)

const title = computed(() =>
  stage.value.kind === 'list'
    ? t('commandLauncher.title')
    : commandLabel(stage.value.command)
)

const { handleEsc } = useOverlayNav(() =>
  stage.value.kind === 'prepare'
    ? { escMode: 'back', onEsc: launcher.back }
    : {}
)

const searchRef = ref<HTMLInputElement | null>(null)
const textRef = ref<HTMLTextAreaElement | null>(null)

const focusStage = () => {
  void nextTick(() => {
    if (props.stopListening) return
    if (stage.value.kind === 'list') searchRef.value?.focus()
    else textRef.value?.focus()
  })
}

const scrollToHighlighted = () => {
  void nextTick(() =>
    document
      .getElementById(`launcher-command-${launcher.highlighted}`)
      ?.scrollIntoView({ block: 'nearest' })
  )
}

/** `1`–`9` of the top row or the numpad, `null` for other keys */
const digitOf = (event: KeyboardEvent): number | null => {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  return match ? Number(match[1]) : null
}

const onSearchKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing || props.stopListening) return
  const digit = digitOf(event)
  // a digit is typed into the search once there is a query; Alt runs anyway
  if (
    digit !== null &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.altKey || !launcher.query)
  ) {
    event.preventDefault()
    if (!event.repeat) void launcher.pickByKey(digit)
    return
  }
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      launcher.move(event.key === 'ArrowDown' ? 1 : -1)
      scrollToHighlighted()
      return
    case 'Enter':
      event.preventDefault()
      if (!event.repeat) void launcher.pickHighlighted()
      return
    case 'Escape':
      // acted on at keyup, like the other menus
      event.preventDefault()
  }
}

const onTextKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing || event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (!event.repeat) void launcher.submit()
}

/**
 * Only an Esc pressed here counts: the release of a key pressed before the
 * window opened must not close it
 */
let escPressed = false

const handleKeyDown = (event: KeyboardEvent) => {
  if (props.stopListening) return
  if (event.code === 'Escape') {
    escPressed = !event.repeat || escPressed
    return
  }
  // the field has handled it, e.g. the Enter that opened this step
  if (event.defaultPrevented) return
  // Enter confirms a command that takes no text; there is no field for it
  if (
    stage.value.kind === 'prepare' &&
    !commandTakesText(stage.value.command) &&
    event.key === 'Enter'
  ) {
    event.preventDefault()
    if (!event.repeat) void launcher.submit()
  }
}

const handleKeyUp = (event: KeyboardEvent) => {
  if (event.code !== 'Escape') return
  const pressed = escPressed
  escPressed = false
  if (!pressed || props.stopListening || stage.value.kind === 'running') {
    return
  }
  event.preventDefault()
  handleEsc()
  focusStage()
}

const handleBlur = () => {
  escPressed = false
}

watch(() => stage.value.kind, focusStage)
watch(() => [ipcStore.params.activationId, props.stopListening], focusStage)

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)
  focusStage()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', handleBlur)
})
</script>

<style scoped>
.launcher-target {
  flex-shrink: 0;
  max-height: 4.5rem;
  overflow: auto;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--app-surface-sunken);
  color: var(--app-text-muted);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.launcher-list-stage,
.launcher-prepare {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 0;
  height: 100%;
  padding: var(--space-sm);
  box-sizing: border-box;
}

.launcher-search {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 55%, transparent);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
}

.launcher-search:focus-within {
  box-shadow: 0 0 0 3px
    color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.launcher-search-icon {
  flex-shrink: 0;
  color: var(--app-text-faint);
}

.launcher-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.9375rem;
  outline: none;
}

.launcher-commands {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.launcher-command {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 2.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.launcher-command.is-highlighted {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.launcher-key {
  flex-shrink: 0;
  min-width: 1.5rem;
  justify-content: center;
}

.launcher-command-icon {
  flex-shrink: 0;
}

.launcher-command-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.launcher-command-name {
  overflow: hidden;
  font-size: 0.9375rem;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.launcher-command-desc {
  margin: 0;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.launcher-command-flag {
  flex-shrink: 0;
  color: var(--app-text-faint);
}

.launcher-empty,
.launcher-confirm {
  margin: 0;
  padding: 0.5rem;
  font-size: 0.875rem;
  color: var(--app-text-muted);
}

.launcher-prepare-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 1rem;
  font-weight: 600;
}

.launcher-text {
  flex: 1 1 0%;
  min-height: 4rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 55%, transparent);
  border-radius: var(--radius-md);
  background-color: var(--app-surface);
  color: var(--color-base-content);
  font: inherit;
  font-size: 0.9375rem;
  resize: none;
  outline: none;
}

.launcher-text:focus {
  box-shadow: 0 0 0 3px
    color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.launcher-selection {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--app-text-muted);
}

.launcher-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-md);
  min-height: 2rem;
}

.launcher-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: 0.8125rem;
}

button.launcher-hint {
  cursor: pointer;
}

button.launcher-hint:hover:not(:disabled) {
  color: var(--color-base-content);
  background-color: var(--app-hover);
}

button.launcher-hint:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
