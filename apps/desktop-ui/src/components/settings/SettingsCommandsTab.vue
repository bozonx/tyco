<template>
  <div class="settings-stack">
    <SettingsSection :description="t('commands.hint')" bare>
      <template #actions>
        <Button
          variant="primary"
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
            <AppIcon
              :icon="tool.icon ?? 'mdi:puzzle-outline'"
              size="lg"
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
        <InlineNotice
          v-if="removed"
          class="commands-notice"
          kind="info"
          announcement="polite"
          icon="mdi:trash-can-outline"
          :message="t('commands.removed', { name: removedName })"
          appearance="surface"
          density="compact"
        >
          <Button size="xs" variant="ghost" icon="mdi:undo" @click="undoRemove">
            {{ t('commands.undo') }}
          </Button>
        </InlineNotice>
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
              :user-config="userConfig"
              :expanded="isExpanded(command.id)"
              :autofocus-name="focusedCommandId === command.id"
              :menu-slot="menuSlots.get(command.id)"
              :launcher-slots="launcherSlots.get(command.id) ?? []"
              :name-conflicts="
                findExternalCommandNameConflicts(commands, command, toolsStore)
              "
              @toggle="toggle(command.id)"
              @drag="startDrag(index, $event)"
              @update="updateCommand(index, $event)"
              @navigate="navigate"
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
        <FieldSwitch
          :model-value="externalAccess.selection"
          :title="t('commands.externalSelection')"
          @update:model-value="setExternalAccess('selection', $event)"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import {
  type ComponentPublicInstance,
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
} from 'vue'

import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
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
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
import { useToolsStore } from '../../stores/tools'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import CommandCard from './CommandCard.vue'
import SettingsSection from './SettingsSection.vue'
import {
  type CommandConfig,
  DEFAULT_EXTERNAL_ACCESS,
  type ExternalAccess,
} from '@tyco/shared'

const props = defineProps<{
  /** A command to open and scroll to, e.g. one just created from the menu */
  focusCommandId?: string
}>()
const { draft: userConfig, navigate } = useSettingsContext()

const { t } = useI18n()
const { toastKey } = useToast()
const secretsStore = useSecretsStore()
const toolsStore = useToolsStore()

// only the known keys: a saved config may still hold the dropped `recording`
const externalAccess = computed<ExternalAccess>(() => ({
  selection:
    userConfig.value.externalAccess?.selection ??
    DEFAULT_EXTERNAL_ACCESS.selection,
}))
const setExternalAccess = (key: keyof ExternalAccess, value: boolean) => {
  userConfig.value.externalAccess = { ...externalAccess.value, [key]: value }
}

const setCommands = (next: CommandConfig[]) => {
  userConfig.value.commands = next
}
const commands = computed(() => normalizeCommands(userConfig.value.commands))

/** The first slot of the action menu that holds each command */
const menuSlots = computed(() => {
  const slots = new Map<string, number>()
  ;(userConfig.value.mainActions ?? []).forEach((slot, index) => {
    if (slot?.type === 'command' && !slots.has(slot.commandId)) {
      slots.set(slot.commandId, index)
    }
  })
  return slots
})

/** Every quick-command page and key assigned to each command. */
const launcherSlots = computed(() => {
  const slots = new Map<string, { page: number; index: number }[]>()
  const pages = userConfig.value.launcherPages.map((page) => page.slots)
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

const { copy } = useCopyValue()

async function copyId(command: CommandConfig) {
  if (await copy(command.id)) toastKey('common.copied', 'success')
}

const focusedCommandId = ref<string | null>(props.focusCommandId ?? null)

const expanded = ref(
  new Set<string>(props.focusCommandId ? [props.focusCommandId] : [])
)
const isExpanded = (id: string) => expanded.value.has(id)

function toggle(id: string) {
  if (focusedCommandId.value === id) {
    focusedCommandId.value = null
  }
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
  moveCommand,
  { getItemKeys: () => commands.value.map((command) => command.id) }
)

function moveCommand(from: number, to: number) {
  setCommands(moveItem(commands.value, from, to))
}

const itemStyle = (index: number) => {
  const offset = itemOffset(index)
  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

function addCommand(toolId: string) {
  pickingTool.value = false
  const command = createCommand(toolId, undefined, toolsStore.get(toolId))
  focusedCommandId.value = command.id
  setCommands([command, ...commands.value])
  expanded.value = new Set([command.id, ...expanded.value])
  void reveal(command.id)
}

function updateCommand(index: number, command: CommandConfig) {
  const next = [...commands.value]
  next[index] = command
  setCommands(next)
}

const settingsSession = useSettingsSessionStore()
const { removed, removeCommand, undoRemove, finishRemoval } =
  createCommandRemovalModel({
    getCommands: () => commands.value,
    getMainActions: () => userConfig.value.mainActions ?? [],
    updateCommands: setCommands,
    updateMainActions: (actions) => {
      userConfig.value.mainActions = actions
    },
    removeSecret: (id) => secretsStore.removeSecret(id),
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
  margin-bottom: var(--space-sm);
}

.commands-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.command-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  transition:
    transform var(--transition-base),
    opacity var(--transition-fast);
}
.command-card:hover {
  --disclosure-panel-border-color: var(--app-border-strong);
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
  box-shadow: var(--app-shadow-lg);
  transition: none;
}
.command-card.is-dragged {
  --disclosure-panel-border-color: var(--color-primary);
}
</style>
