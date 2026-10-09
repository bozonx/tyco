<template>
  <SettingsSection :description="t('commands.hint')" bare>
    <div class="commands-tab">
      <div v-if="removed" class="commands-notice" role="status">
        <Icon icon="mdi:trash-can-outline" width="16" height="16" />
        <span class="commands-notice-text">
          {{ t('commands.removed', { name: removedName }) }}
        </span>
        <Button xs ghost icon="mdi:undo" @click="undoRemove">
          {{ t('commands.undo') }}
        </Button>
      </div>
      <p v-if="!commands.length" class="commands-empty">
        {{ t('commands.empty') }}
      </p>

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
              !command.enabled || Boolean(unavailableReason(command)),
          }"
          :style="itemStyle(index)"
        >
          <div class="command-header">
            <div
              class="drag-handle"
              :title="t('settings.dragToReorder')"
              @pointerdown="startDrag(index, $event)"
            >
              <Icon icon="mdi:drag-vertical" width="18" height="18" />
            </div>
            <button
              type="button"
              class="command-summary"
              :aria-expanded="isExpanded(command.id)"
              @click="toggle(command.id)"
            >
              <Icon
                :icon="commandIcon(command, toolsStore)"
                width="18"
                height="18"
                class="shrink-0"
              />
              <span class="command-name" :class="{ 'is-empty': !command.name }">
                {{ command.name || t('commands.unnamed') }}
              </span>
              <span
                v-if="!commandTakesText(command, toolsStore)"
                class="command-badge"
              >
                {{ t('commands.badgeNoText') }}
              </span>
              <span v-if="inMenu.has(command.id)" class="command-badge">
                {{ t('commands.badgeInMenu') }}
              </span>
              <span
                v-if="command.enabled && unavailableReason(command)"
                class="command-badge is-muted"
                :title="t(unavailableReason(command)!)"
              >
                {{ t('commands.badgeUnavailable') }}
              </span>
              <span
                v-if="
                  validateCommand(command, toolsStore).length ||
                  externalNameTwins(commands, command, toolsStore).length
                "
                class="command-badge is-warning"
                :title="t('commands.badgeIssuesHint')"
              >
                <Icon icon="mdi:alert-outline" width="14" height="14" />
              </span>
              <Icon
                icon="mdi:chevron-down"
                width="18"
                height="18"
                class="command-chevron"
                :class="{ 'rotate-180': isExpanded(command.id) }"
              />
            </button>
            <Button
              :class="
                command.availableIn.external
                  ? 'external-btn is-on'
                  : 'external-btn'
              "
              xs
              ghost
              square
              :aria-pressed="command.availableIn.external"
              :title="t('commands.external')"
              :aria-label="t('commands.external')"
              @click="
                setCommand(command.id, {
                  availableIn: {
                    ...command.availableIn,
                    external: !command.availableIn.external,
                  },
                })
              "
            >
              <Icon icon="mdi:console-line" width="16" height="16" />
            </Button>
            <FieldCheckbox
              class="enabled-switch"
              :value="command.enabled"
              :title="t('commands.enabled')"
              @update:value="setCommand(command.id, { enabled: $event })"
            />
            <Button
              class="delete-btn"
              xs
              ghost
              square
              :title="t('common.delete')"
              @click="removeCommand(command)"
            >
              <Icon icon="mdi:trash-can-outline" width="16" height="16" />
            </Button>
          </div>

          <div v-if="isExpanded(command.id)" class="command-body">
            <CommandEditor
              :command="command"
              :user-config="userConfig"
              :in-menu="inMenu.has(command.id)"
              :name-twins="externalNameTwins(commands, command, toolsStore)"
              @update="updateCommand(index, $event)"
            />
          </div>
        </div>
      </div>

      <div class="commands-add">
        <Button
          class="add-btn"
          sm
          ghost
          :aria-expanded="pickingTool"
          @click="pickingTool = !pickingTool"
        >
          <Icon icon="mdi:plus" width="16" height="16" />
          {{ t('commands.create') }}
        </Button>
      </div>
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
    </div>
  </SettingsSection>

  <SettingsSection
    :title="t('commands.externalTitle')"
    :description="t('commands.externalDescription')"
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
    <FieldRow
      :label="t('commands.externalRecording')"
      :info="t('commands.externalRecordingInfo')"
    >
      <FieldCheckbox
        :value="externalAccess.recording"
        :title="t('commands.externalRecording')"
        @update:value="setExternalAccess('recording', $event)"
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

import { useI18n } from '../../composables/useI18n'
import { useSortableList } from '../../composables/useSortableList'
import {
  commandIcon,
  commandTakesText,
  commandUnavailableReason,
  createCommand,
  externalNameTwins,
  normalizeCommands,
  removeCommandReferences,
  restoreCommand,
  restoreCommandReferences,
  validateCommand,
  webhookToolConfig,
} from '../../lib/commands/command-config'
import { moveItem } from '../../lib/sortable/sortable-list'
import { toolLabel } from '../../lib/tools/tool-label'
import { useLlmStore } from '../../stores/llm'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import CommandEditor from './CommandEditor.vue'
import { Icon } from '@iconify/vue'
import {
  type CommandConfig,
  DEFAULT_EXTERNAL_ACCESS,
  type ExternalAccess,
  type MainActionConfig,
  type UserConfig,
  webhookSecretId,
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
}>()

const { t } = useI18n()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()

const externalAccess = computed(() => ({
  ...DEFAULT_EXTERNAL_ACCESS,
  ...props.userConfig.externalAccess,
}))
const setExternalAccess = (key: keyof ExternalAccess, value: boolean) =>
  emit('update:externalAccess', { ...externalAccess.value, [key]: value })

const commands = computed(() => normalizeCommands(props.userConfig.commands))

function setCommand(id: string, patch: Partial<CommandConfig>) {
  emit(
    'update:commands',
    commands.value.map((command) =>
      command.id === id ? { ...command, ...patch } : command
    )
  )
}

const inMenu = computed(
  () =>
    new Set(
      (props.userConfig.mainActions ?? []).flatMap((slot) =>
        slot?.type === 'command' ? [slot.commandId] : []
      )
    )
)

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

const unavailableReason = (command: CommandConfig) =>
  commandUnavailableReason(command, toolsStore)

/** The tool picker of a new command is open */
const pickingTool = ref(false)

/** The tools a command can be made of, the unavailable ones with the reason */
const tools = computed(() =>
  toolsStore.list().map((tool) => {
    const reason = tool.unavailableReason?.()
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
  }
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

/** A removed command the user can still bring back */
interface RemovedCommand {
  command: CommandConfig
  index: number
  /** The menu before the removal, when the command was in it */
  mainActions?: (MainActionConfig | null)[]
}

const removed = ref<RemovedCommand | null>(null)
const removedName = computed(
  () => removed.value?.command.name.trim() || t('commands.unnamed')
)

/** The command leaves the menu at once; its webhook token once undo is gone */
function removeCommand(command: CommandConfig) {
  finishRemoval()
  const index = commands.value.findIndex((item) => item.id === command.id)
  const mainActions = props.userConfig.mainActions ?? []
  removed.value = {
    command,
    index,
    mainActions: inMenu.value.has(command.id) ? [...mainActions] : undefined,
  }
  emit(
    'update:commands',
    commands.value.filter((item) => item.id !== command.id)
  )
  if (removed.value.mainActions) {
    emit('update:mainActions', removeCommandReferences(mainActions, command.id))
  }
}

function undoRemove() {
  const entry = removed.value
  if (!entry) return
  removed.value = null
  emit(
    'update:commands',
    restoreCommand(commands.value, entry.command, entry.index)
  )
  if (entry.mainActions) {
    emit(
      'update:mainActions',
      restoreCommandReferences(
        props.userConfig.mainActions ?? [],
        entry.mainActions,
        entry.command.id
      )
    )
  }
}

/** Undo is no longer offered: the token of a removed webhook goes too */
function finishRemoval() {
  const entry = removed.value
  removed.value = null
  if (!entry) return
  const { command } = entry
  if (command.toolId === 'webhook' && webhookToolConfig(command).authSecret) {
    llmStore.removeSecret(webhookSecretId(command.id)).catch(() => {
      // a leftover token is bound to its origin and harmless
    })
  }
}

onBeforeUnmount(finishRemoval)
</script>

<style scoped>
.tool-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.tool-picker-hint {
  font-size: 0.75rem;
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
  font-size: 0.875rem;
}

.tool-option-description,
.tool-option-reason {
  font-size: 0.75rem;
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

.commands-empty {
  font-size: 0.875rem;
  color: var(--app-text-muted);
}

.commands-notice {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md, var(--radius-sm));
  background-color: var(--app-surface);
  font-size: 0.8125rem;
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

.command-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-xs);
}

.command-summary {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  text-align: left;
  cursor: pointer;
}

.command-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.command-name.is-empty,
.command-card.is-disabled .command-name {
  color: var(--app-text-muted);
}

.command-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  color: var(--app-text-muted);
}

.command-badge.is-muted {
  color: var(--app-text-faint);
}

.command-badge.is-warning {
  border-color: transparent;
  color: var(--color-warning);
}

.command-chevron {
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.7;
  transition: transform var(--transition-fast);
}

.command-body {
  padding: var(--space-sm) var(--space-md) var(--space-md)
    calc(var(--space-xs) + 1.25rem + var(--space-xs));
  border-top: 1px solid var(--app-border);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--app-text-faint);
  cursor: grab;
  opacity: 0;
  pointer-events: none;
  /* Touch and pen drags must not scroll the page instead */
  touch-action: none;
  transition:
    color var(--transition-fast),
    opacity var(--transition-fast);
}

.drag-handle:hover {
  color: var(--color-base-content);
}

.command-card:hover .drag-handle,
.command-card:focus-within .drag-handle,
.command-card.is-sorting .drag-handle,
.command-card.is-dragged .drag-handle {
  opacity: 1;
  pointer-events: auto;
}

.external-btn {
  color: var(--app-text-faint);
}

.external-btn.is-on {
  color: var(--color-primary);
}

.enabled-switch {
  margin: 0 var(--space-xs);
}

.delete-btn {
  color: var(--app-text-muted);
}

.delete-btn:hover {
  color: var(--color-error);
}

.commands-add {
  display: flex;
  gap: var(--space-sm);
}

.add-btn {
  flex: 1;
  justify-content: center;
  border: 1px dashed var(--app-border-strong);
  color: var(--app-text-muted);
}

.add-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
</style>
