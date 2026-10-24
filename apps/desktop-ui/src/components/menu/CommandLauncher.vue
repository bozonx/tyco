<template>
  <ActionOverlayLayout
    :title="title"
    :on-esc="
      stage.kind === 'prepare'
        ? launcher.back
        : isSearchMode
          ? closeSearch
          : undefined
    "
    :esc-mode="stage.kind === 'prepare' || isSearchMode ? 'back' : 'auto'"
  >
    <template #preview>
      <div v-if="stage.kind === 'prepare'" class="launcher-prepare">
        <div class="launcher-prepare-head">
          <AppIcon :icon="commandIcon(stage.command, toolsStore)" size="xl" />
          <span class="launcher-prepare-name">
            {{ commandLabel(stage.command) }}
          </span>
        </div>
        <p v-if="stage.command.description" class="launcher-command-desc">
          {{ stage.command.description }}
        </p>
        <code
          v-if="target"
          class="command-target"
          :title="t('commandLauncher.targetHint')"
        >
          {{ target }}
        </code>
        <FieldTextArea
          ref="textRef"
          class="launcher-text"
          :model-value="launcher.inputText"
          :placeholder="t('commandLauncher.textPlaceholder')"
          :aria-label="t('commandLauncher.textPlaceholder')"
          @update:model-value="launcher.setText"
          @keydown="onTextKeyDown"
        />
      </div>

      <InProgressMessage
        v-else-if="stage.kind === 'running'"
        :label="
          t('commandLauncher.running', { name: commandLabel(stage.command) })
        "
        :on-cancel="launcher.cancel"
      />

      <!-- the selection may be a leftover of an earlier one: the user sees it
           and can drop it before running a command -->
      <SelectionContextPreview
        v-else-if="hasSelection"
        class="launcher-selection"
        icon="mdi:format-quote-open"
        :text="selectedText"
        :title="t('commandLauncher.selection', { count: selectedText.length })"
        :remove-title="t('commandLauncher.dropSelection')"
        @remove="launcher.dropSelection"
      />
    </template>

    <template #actions>
      <template v-if="stage.kind === 'prepare'">
        <div class="launcher-hints">
          <ShortcutHint
            :keys="['Enter']"
            interactive
            :disabled="!launcher.canSubmit"
            @click="void launcher.submit()"
            >{{ t('commandLauncher.hintRun') }}</ShortcutHint
          >
          <ShortcutHint :keys="['Shift', 'Enter']">{{
            t('commandLauncher.hintNewLine')
          }}</ShortcutHint>
          <ShortcutHint :keys="['Esc']" interactive @click="launcher.back">{{
            t('common.back')
          }}</ShortcutHint>
        </div>
      </template>

      <template v-else-if="stage.kind === 'list'">
        <QueryPanel
          v-if="isSearchMode"
          v-model="query"
          :placeholder="t('commandLauncher.searchPlaceholder')"
          :options="searchOptions"
          :hints="searchHints"
          :empty-text="t('commandLauncher.nothingFound')"
          auto-highlight
          @submit="submitSearch"
          @back="closeSearch"
        />
        <div v-else>
          <div class="launcher-hints launcher-pages">
            <span class="launcher-pages-label">{{
              t('commandLauncher.pages')
            }}</span>
            <ShortcutHint
              v-for="index in launcher.pageCount"
              :key="index"
              :keys="[String(index === 10 ? 0 : index)]"
              interactive
              :aria-pressed="launcher.pageIndex === index - 1"
              :aria-label="t('settings.launcherPage', { page: index })"
              :title="t('settings.launcherPage', { page: index })"
              @click="launcher.setPage(index - 1)"
            />
            <ShortcutHint
              :keys="['PageUp', 'PageDown']"
              class="launcher-pages-tab"
            />
          </div>
          <ShortcutList
            :key="launcher.pageIndex"
            :text="selectedText"
            :space-key="searchAction"
            :left-letter-keys="leftLetterKeys"
            :shortcuts-disabled="props.shortcutsDisabled"
          />
        </div>
      </template>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import { searchCommands } from '../../lib/command-launcher/launcher-model'
import {
  commandIcon,
  commandLabel,
  commandTarget,
  isCommandAvailable,
} from '../../lib/commands/command-runtime'
import type { TextControl } from '../../lib/ui/text-control'
import { type ActionItem } from '../../stores/action-menu'
import { useCommandLauncherStore } from '../../stores/command-launcher'
import { useDesktopStore } from '../../stores/desktop'
import { useToolsStore } from '../../stores/tools'
import AppIcon from '../common/AppIcon.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import SelectionContextPreview from '../overlay/SelectionContextPreview.vue'
import ShortcutHint from '../overlay/ShortcutHint.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import InProgressMessage from './InProgressMessage.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'

const props = withDefaults(defineProps<{ shortcutsDisabled?: boolean }>(), {
  shortcutsDisabled: false,
})

const { t } = useI18n()
const desktopStore = useDesktopStore()
const launcher = useCommandLauncherStore()
const toolsStore = useToolsStore()

const stage = computed(() => launcher.stage)
const selectedText = computed(() => launcher.selection)
const hasSelection = computed(() => Boolean(selectedText.value.trim()))

const isSearchMode = ref(false)
const query = ref('')

/** What the prepared command runs, so the user knows before it does */
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
  isSearchMode.value = false
  query.value = ''
}

const { handleEsc } = useOverlayNav(() => {
  if (stage.value.kind === 'prepare') {
    return { escMode: 'back', onEsc: launcher.back }
  }
  if (isSearchMode.value) {
    return { escMode: 'back', onEsc: closeSearch }
  }
  return {}
})

const textRef = ref<TextControl | null>(null)

const focusStage = () => {
  void nextTick(() => {
    if (props.shortcutsDisabled) return
    if (stage.value.kind === 'prepare') textRef.value?.focus()
  })
}

const searchAction = computed<ActionItem>(() => ({
  labelKey: 'commandLauncher.allCommands',
  icon: 'mdi:magnify',
  action: async () => {
    isSearchMode.value = true
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
    isSearchMode.value = false
    query.value = ''
    void launcher.pick(cmd)
  }
}

const onTextKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing || event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (!event.repeat) void launcher.submit()
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (props.shortcutsDisabled) return
  if (
    stage.value.kind === 'list' &&
    !isSearchMode.value &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing
  ) {
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      if (!event.repeat) launcher.nextPage(event.key === 'PageUp' ? -1 : 1)
    } else if (/^[1-9]$/.test(event.key) || event.key === '0') {
      event.preventDefault()
      launcher.setPage(event.key === '0' ? 9 : Number(event.key) - 1)
    } else if (event.key === 'Backspace' && hasSelection.value) {
      event.preventDefault()
      launcher.dropSelection()
    }
  }
}

useDismissibleLayer({
  isOpen: () => !props.shortcutsDisabled,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => {
    if (stage.value.kind === 'running') return
    handleEsc()
    focusStage()
  },
})

watch(
  () => stage.value.kind,
  (kind) => {
    if (kind === 'prepare') {
      isSearchMode.value = false
    }
    focusStage()
  }
)

watch(
  () => [desktopStore.desktopState.activationId, props.shortcutsDisabled],
  () => {
    isSearchMode.value = false
    query.value = ''
    focusStage()
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  focusStage()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
.launcher-pages {
  gap: var(--space-xs);
  max-height: 5rem;
  overflow-y: auto;
  margin-bottom: var(--space-sm);
}

.launcher-pages-label {
  color: var(--app-text-muted);
  font-size: var(--text-control);
  margin-right: 0.125rem;
}

.launcher-pages button[aria-pressed='true'] {
  background-color: transparent;

  --key-border-color: color-mix(
    in oklab,
    var(--color-primary) 60%,
    transparent
  );
  --key-color: var(--color-primary);
  --key-background: color-mix(in oklab, var(--color-primary) 14%, transparent);
}

.launcher-pages-tab {
  margin-left: var(--space-xs);
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

.launcher-prepare-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-title);
  font-weight: 600;
}

.launcher-command-desc {
  margin: 0;
  overflow: hidden;
  font-size: var(--text-caption);
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
  font-size: var(--text-title);
  resize: none;
  outline: none;
}

.launcher-text:focus {
  box-shadow: 0 0 0 3px
    color-mix(in oklab, var(--color-primary) 16%, transparent);
}

.launcher-selection {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-height: 0;
  height: 100%;
}

.launcher-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-md);
  min-height: 2rem;
}
</style>
