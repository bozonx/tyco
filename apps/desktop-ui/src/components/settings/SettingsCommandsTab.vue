<template>
  <SettingsSection :description="t('commands.hint')" bare>
    <template #actions>
      <Button
        class="add-btn"
        size="sm"
        icon="mdi:plus"
        :aria-expanded="pickingTool"
        @click="pickingTool = !pickingTool"
      >
        {{ t('commands.create') }}
      </Button>
    </template>
    <div class="commands-tab">
      <div v-if="pickingTool" class="tool-picker">
        <p class="tool-picker-hint">{{ t('commands.pickTool') }}</p>
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="tool-option"
          :class="{ 'is-unavailable': tool.reason }"
          @click="addCommand(tool.id)"
        >
          <Icon
            :icon="tool.icon ?? 'mdi:puzzle-outline'"
            width="18"
            height="18"
            class="shrink-0"
          />
          <span class="tool-option-text">
            <span class="tool-option-name">{{ tool.name }}</span>
            <span v-if="tool.description" class="tool-option-description">
              {{ tool.description }}
            </span>
            <span v-if="tool.reason" class="tool-option-reason">
              {{ tool.reason }}
            </span>
          </span>
        </button>
      </div>
      <div v-if="removed" class="commands-notice" role="status">
        <Icon icon="mdi:trash-can-outline" width="16" height="16" />
        <span class="commands-notice-text">
          {{ t('commands.removed', { name: removedName }) }}
        </span>
        <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemove">
          {{ t('commands.undo') }}
        </Button>
      </div>
      <StateMessage
        v-if="!commands.length"
        class="commands-empty"
        :message="t('commands.empty')"
      />

      <div ref="listRef" class="commands-list">
        <div
          v-for="(command, index) in commands"
          :key="command.id"
          :ref="(el) => setItemRef(command.id, el)"
          data-sortable-item
          class="command-card"
          :class="{
            'is-sorting': isSorting,
            'is-dragged': draggedIndex === index,
            'is-disabled':
              !command.enabled || Boolean(getUnavailableReasonKey(command)),
          }"
          :style="itemStyle(index)"
        >
          <CommandCard
            :command="command"
            :can-move-up="index > 0"
            :can-move-down="index < commands.length - 1"
            :user-config="userConfig"
            :expanded="isExpanded(command.id)"
            :menu-slot="menuSlots.get(command.id)"
            :launcher-slots="launcherSlots.get(command.id) ?? []"
            :name-conflicts="
              findExternalCommandNameConflicts(commands, command, toolsStore)
            "
            @toggle="toggle(command.id)"
            @drag="startDrag(index, $event)"
            @move="
              emit('update:commands', moveItem(commands, index, index + $event))
            "
            @update="updateCommand(index, $event)"
            @navigate="emit('navigate', $event)"
            @copy-id="copyId(command)"
            @remove="removeCommand(command)"
          />
        </div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    :title="t('commands.externalTitle')"
    :info="t('commands.externalDescription')"
  >
    <FieldRow
      :label="t('commands.externalSelection')"
      :info="t('commands.externalSelectionInfo')"
    >
      <FieldCheckbox
        :value="externalAccess.selection"
        :title="t('commands.externalSelection')"
        @update:value="setExternalAccess('selection', $event)"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import {
  type ComponentPublicInstance,
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
} from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSortableList } from '../../composables/use-sortable-list'
import useToast from '../../composables/use-toast'
import {
  createCommand,
  normalizeCommands,
} from '../../lib/commands/command-config'
import { findExternalCommandNameConflicts } from '../../lib/commands/command-external'
import { createCommandRemovalModel } from '../../lib/commands/command-removal-model'
import { commandUnavailableReason } from '../../lib/commands/command-runtime'
import { clientLogger } from '../../lib/logger'
import { moveItem } from '../../lib/sortable/sortable-list'
import { toolLabel } from '../../lib/tools/tool-label'
import { useLlmStore } from '../../stores/llm'
import { useSettingsSessionStore } from '../../stores/settings-session'
import { useToolsStore } from '../../stores/tools'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import StateMessage from '../common/StateMessage.vue'
import CommandCard from './CommandCard.vue'
import {
  type CommandConfig,
  DEFAULT_EXTERNAL_ACCESS,
  type ExternalAccess,
  type MainActionConfig,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{
  userConfig: UserConfig
  /** A command to open and scroll to, e.g. one just created from the menu */
  focusCommandId?: string
}>()

const emit = defineEmits<{
  (event: 'update:externalAccess', value: ExternalAccess): void
  (event: 'update:commands', value: CommandConfig[]): void
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
  /** Opens another tab of the settings */
  (event: 'navigate', tab: string): void
}>()

const { t } = useI18n()
const { toastKey } = useToast()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()

// only the known keys: a saved config may still hold the dropped `recording`
const externalAccess = computed<ExternalAccess>(() => ({
  selection:
    props.userConfig.externalAccess?.selection ??
    DEFAULT_EXTERNAL_ACCESS.selection,
}))
const setExternalAccess = (key: keyof ExternalAccess, value: boolean) =>
  emit('update:externalAccess', { ...externalAccess.value, [key]: value })

const commands = computed(() => normalizeCommands(props.userConfig.commands))

/** The first slot of the action menu that holds each command */
const menuSlots = computed(() => {
  const slots = new Map<string, number>()
  ;(props.userConfig.mainActions ?? []).forEach((slot, index) => {
    if (slot?.type === 'command' && !slots.has(slot.commandId)) {
      slots.set(slot.commandId, index)
    }
  })
  return slots
})

/** Every quick-command page and key assigned to each command. */
const launcherSlots = computed(() => {
  const slots = new Map<string, { page: number; index: number }[]>()
  const pages = props.userConfig.launcherPages.map((page) => page.slots)
  pages.forEach((commands, page) => {
    commands.forEach((id, index) => {
      if (!id) return
      const placements = slots.get(id) ?? []
      placements.push({ page, index })
      slots.set(id, placements)
    })
  })
  return slots
})

async function copyId(command: CommandConfig) {
  try {
    await navigator.clipboard.writeText(command.id)
    toastKey('commands.idCopied', 'success')
  } catch {
    // clipboard access might be denied
  }
}

const expanded = ref(
  new Set<string>(props.focusCommandId ? [props.focusCommandId] : [])
)
const isExpanded = (id: string) => expanded.value.has(id)

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const itemRefs = new Map<string, HTMLElement>()

function setItemRef(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) itemRefs.set(id, el)
  else itemRefs.delete(id)
}

async function reveal(id: string) {
  await nextTick()
  itemRefs.get(id)?.scrollIntoView?.({ block: 'nearest' })
}

if (props.focusCommandId) void reveal(props.focusCommandId)

const getUnavailableReasonKey = (command: CommandConfig) =>
  commandUnavailableReason(command, toolsStore)

/** The tool picker of a new command is open */
const pickingTool = ref(false)

/** The tools a command can be made of, the unavailable ones with the reason */
const tools = computed(() =>
  toolsStore.list().map((tool) => {
    const reason = tool.getUnavailableReasonKey?.()
    return {
      id: tool.id,
      icon: tool.icon,
      name: toolLabel(tool, t),
      description: tool.descriptionKey ? t(tool.descriptionKey) : '',
      reason: reason ? t(reason) : '',
    }
  })
)

const listRef = ref<HTMLElement | null>(null)
const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => {
    emit('update:commands', moveItem(commands.value, from, to))
  },
  { getItemKeys: () => commands.value.map((command) => command.id) }
)

const itemStyle = (index: number) => {
  const offset = itemOffset(index)
  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

function addCommand(toolId: string) {
  pickingTool.value = false
  const command = createCommand(toolId, undefined, toolsStore.get(toolId))
  emit('update:commands', [...commands.value, command])
  expanded.value = new Set([...expanded.value, command.id])
  void reveal(command.id)
}

function updateCommand(index: number, command: CommandConfig) {
  const next = [...commands.value]
  next[index] = command
  emit('update:commands', next)
}

const settingsSession = useSettingsSessionStore()
const { removed, removeCommand, undoRemove, finishRemoval } =
  createCommandRemovalModel({
    getCommands: () => commands.value,
    getMainActions: () => props.userConfig.mainActions ?? [],
    updateCommands: (commands) => emit('update:commands', commands),
    updateMainActions: (actions) => emit('update:mainActions', actions),
    removeSecret: (id) => llmStore.removeSecret(id),
    persist: settingsSession.persist,
    isSaved: settingsSession.isSaved,
    notifyError: (error) =>
      clientLogger.error('Could not remove command secrets', {
        error: String(error),
      }),
  })
const removedName = computed(
  () => removed.value?.command.name.trim() || t('commands.unnamed')
)

onBeforeUnmount(finishRemoval)
</script>

<style scoped>
.tool-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
  padding: var(--space-sm, 0.5rem);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
}

.tool-picker-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.tool-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm, 0.5rem);
  padding: var(--space-xs, 0.25rem) var(--space-sm, 0.5rem);
  border-radius: var(--radius-sm);
  text-align: left;
}

.tool-option:hover,
.tool-option:focus-visible {
  background: var(--app-hover);
}

.tool-option.is-unavailable {
  opacity: 0.6;
}

.tool-option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tool-option-name {
  font-size: var(--text-body);
}

.tool-option-description,
.tool-option-reason {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.tool-option-reason {
  color: var(--color-warning);
}

.commands-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.commands-notice {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md, var(--radius-sm));
  background-color: var(--app-surface);
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.commands-notice-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commands-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.command-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-sm);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    opacity var(--transition-fast);
}

.command-card:hover {
  border-color: var(--app-border-strong);
}

/* Neighbours glide into place only while a drag is in progress */
.command-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.command-card.is-dragged {
  position: relative;
  z-index: 1;
  border-color: var(--color-primary);
  box-shadow: var(--app-shadow-lg);
  transition: none;
}

.command-card.is-disabled :deep(.command-name) {
  color: var(--app-text-muted);
}

.command-card:hover :deep(.drag-handle),
.command-card:focus-within :deep(.drag-handle),
.command-card.is-sorting :deep(.drag-handle),
.command-card.is-dragged :deep(.drag-handle) {
  opacity: 1;
  pointer-events: auto;
}
</style>
