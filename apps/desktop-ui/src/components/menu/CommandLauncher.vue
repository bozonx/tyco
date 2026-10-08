<template>
  <ActionOverlayLayout
    :title="title"
    :onEsc="
      stage.kind === 'prepare'
        ? launcher.back
        : searchMode
          ? closeSearch
          : undefined
    "
    :escMode="stage.kind === 'prepare' || searchMode ? 'back' : 'auto'"
  >
    <template
      v-if="stage.kind === 'list' && !searchMode && hasSelection"
      #header-extra
    >
      <span class="launcher-selection" :title="selectedText">
        <Icon icon="mdi:format-quote-open" height="14" />
        {{ t('commandLauncher.selection', { count: selectedText.length }) }}
      </span>
    </template>

    <template #preview>
      <div v-if="stage.kind === 'prepare'" class="launcher-prepare">
        <div class="launcher-prepare-head">
          <Icon :icon="commandIcon(stage.command, toolsStore)" height="20" />
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
          v-if="commandTakesText(stage.command, toolsStore)"
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
        v-else-if="stage.kind === 'running'"
        :label="
          t('commandLauncher.running', { name: commandLabel(stage.command) })
        "
        :onCancel="launcher.cancel"
      />

      <TextPreview v-else-if="hasSelection" :text="selectedText" />
    </template>

    <template #actions>
      <template v-if="stage.kind === 'prepare'">
        <div class="launcher-hints">
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
          <span
            v-if="commandTakesText(stage.command, toolsStore)"
            class="launcher-hint"
          >
            <KeyButton>Shift</KeyButton><KeyButton>Enter</KeyButton>
            {{ t('commandLauncher.hintNewLine') }}
          </span>
          <button
            type="button"
            class="launcher-hint"
            @mousedown.prevent
            @click="launcher.back"
          >
            <KeyButton>Esc</KeyButton>
            {{ t('common.back') }}
          </button>
        </div>
      </template>

      <template v-else-if="stage.kind === 'list'">
        <QueryPanel
          v-if="searchMode"
          v-model="query"
          :placeholder="t('commandLauncher.searchPlaceholder')"
          :options="searchOptions"
          :hints="searchHints"
          :emptyText="t('commandLauncher.nothingFound')"
          autoHighlight
          @submit="submitSearch"
          @back="closeSearch"
        />
        <ShortcutList
          v-else
          :text="selectedText"
          :spaceKey="searchAction"
          :leftLetterKeys="leftLetterKeys"
          :stopListening="props.stopListening"
        />
      </template>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useOverlayNav } from '../../composables/useOverlayNav'
import { searchCommands } from '../../lib/command-launcher/launcher-model'
import {
  commandIcon,
  commandLabel,
  commandTakesText,
  commandTarget,
  isCommandAvailable,
} from '../../lib/commands/command-config'
import { type ActionItem } from '../../stores/actionMenu'
import { useCommandLauncherStore } from '../../stores/commandLauncher'
import { useIpcStore } from '../../stores/ipc'
import { useToolsStore } from '../../stores/tools'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import KeyButton from '../common/KeyButton.vue'
import TextPreview from '../common/TextPreview.vue'
import InProgressMessage from './InProgressMessage.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import { Icon } from '@iconify/vue'

const props = withDefaults(defineProps<{ stopListening?: boolean }>(), {
  stopListening: false,
})

const { t } = useI18n()
const ipcStore = useIpcStore()
const launcher = useCommandLauncherStore()
const toolsStore = useToolsStore()

const stage = computed(() => launcher.stage)
const selectedText = computed(() => ipcStore.params.selectedText ?? '')
const hasSelection = computed(() => Boolean(selectedText.value.trim()))

const searchMode = ref(false)
const query = ref('')

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

const closeSearch = () => {
  searchMode.value = false
  query.value = ''
}

const { handleEsc } = useOverlayNav(() => {
  if (stage.value.kind === 'prepare') {
    return { escMode: 'back', onEsc: launcher.back }
  }
  if (searchMode.value) {
    return { escMode: 'back', onEsc: closeSearch }
  }
  return {}
})

const textRef = ref<HTMLTextAreaElement | null>(null)

const focusStage = () => {
  void nextTick(() => {
    if (props.stopListening) return
    if (stage.value.kind === 'prepare') textRef.value?.focus()
  })
}

const searchAction = computed<ActionItem>(() => ({
  labelKey: 'commandLauncher.allCommands',
  icon: 'mdi:magnify',
  action: async () => {
    searchMode.value = true
    query.value = ''
  },
}))

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  launcher.slotCommands.map((command) => {
    if (!command) return undefined
    const available = isCommandAvailable(command, toolsStore)
    return {
      name: commandLabel(command),
      icon: commandIcon(command, toolsStore),
      hint: command.description,
      disabled: !available,
      action: async () => {
        await launcher.pick(command)
      },
    }
  })
)

const searchOptions = computed<QueryPanelOption[]>(() => {
  const q = query.value.trim()
  const list = q ? searchCommands(launcher.commands, q) : launcher.commands
  return list.map((cmd) => ({
    id: cmd.id,
    label: commandLabel(cmd),
    hint: cmd.description,
    icon: commandIcon(cmd, toolsStore),
  }))
})

const searchHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('commandLauncher.hintRun'),
    disabled: searchOptions.value.length === 0,
  },
  { keys: ['Esc'], label: t('common.back'), action: closeSearch },
])

function submitSearch({ option }: QueryPanelSubmit) {
  if (!option) return
  const cmd = launcher.commands.find((c) => c.id === option.id)
  if (cmd) {
    searchMode.value = false
    query.value = ''
    void launcher.pick(cmd)
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
    !commandTakesText(stage.value.command, toolsStore) &&
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

watch(
  () => stage.value.kind,
  (kind) => {
    if (kind === 'prepare') {
      searchMode.value = false
    }
    focusStage()
  }
)

watch(
  () => [ipcStore.params.activationId, props.stopListening],
  () => {
    searchMode.value = false
    query.value = ''
    focusStage()
  }
)

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

.launcher-prepare {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 0;
  height: 100%;
  padding: var(--space-sm);
  box-sizing: border-box;
}

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

.launcher-command-desc {
  margin: 0;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
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
