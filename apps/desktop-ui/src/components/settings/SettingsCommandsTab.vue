<template>
  <SettingsSection :description="t('commands.hint')" bare>
    <div class="commands-tab">
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
              <span class="command-badge">{{ toolName(command) }}</span>
              <span
                v-if="!commandTakesText(command, toolsStore)"
                class="command-badge"
              >
                {{ t('commands.badgeNoText') }}
              </span>
              <span v-if="inMenu.has(command.id)" class="command-badge">
                {{ t('commands.badgeInMenu') }}
              </span>
              <span v-if="command.availableIn.launcher" class="command-badge">
                {{ t('commands.badgeInLauncher') }}
              </span>
              <span v-if="command.availableIn.external" class="command-badge">
                {{ t('commands.badgeExternal') }}
              </span>
              <span v-if="!command.enabled" class="command-badge is-muted">
                {{ t('commands.badgeDisabled') }}
              </span>
              <span
                v-else-if="unavailableReason(command)"
                class="command-badge is-muted"
                :title="t(unavailableReason(command)!)"
              >
                {{ t('commands.badgeUnavailable') }}
              </span>
              <span
                v-if="addedBy(command)"
                class="command-badge is-muted"
                :title="addedBy(command)"
              >
                <Icon icon="mdi:star-outline" width="14" height="14" />
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
</template>

<script setup lang="ts">
import { type ComponentPublicInstance, computed, nextTick, ref } from 'vue'

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
  validateCommand,
  webhookToolConfig,
} from '../../lib/commands/command-config'
import { moveItem } from '../../lib/sortable/sortable-list'
import { toolLabel } from '../../lib/tools/tool-label'
import { useLlmStore } from '../../stores/llm'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import SettingsSection from '../common/SettingsSection.vue'
import CommandEditor from './CommandEditor.vue'
import { Icon } from '@iconify/vue'
import {
  type CommandConfig,
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
  (event: 'update:commands', value: CommandConfig[]): void
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
}>()

const { t } = useI18n()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()

const commands = computed(() => normalizeCommands(props.userConfig.commands))

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

const toolName = (command: CommandConfig) => {
  const tool = toolsStore.get(command.toolId)
  return tool ? toolLabel(tool, t) : command.toolId
}

const unavailableReason = (command: CommandConfig) =>
  commandUnavailableReason(command, toolsStore)

/** Who added a default command: the app or a plugin */
function addedBy(command: CommandConfig): string {
  if (!command.id.startsWith('default:')) return ''
  const owner = toolsStore.get(command.toolId)?.owner
  return owner?.kind === 'plugin'
    ? t('commands.addedByPlugin', { name: owner.name })
    : t('commands.addedByApp')
}

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

/** The command leaves the menu, and its webhook token goes with it */
function removeCommand(command: CommandConfig) {
  const name = command.name.trim() || t('commands.unnamed')
  const hasSecret =
    command.toolId === 'webhook' && webhookToolConfig(command).authSecret
  const question = t(
    hasSecret ? 'commands.removeConfirmSecret' : 'commands.removeConfirm',
    { name }
  )
  if (!window.confirm(question)) return
  emit(
    'update:commands',
    commands.value.filter((item) => item.id !== command.id)
  )
  if (inMenu.value.has(command.id)) {
    emit(
      'update:mainActions',
      removeCommandReferences(props.userConfig.mainActions ?? [], command.id)
    )
  }
  if (command.toolId === 'webhook' && webhookToolConfig(command).authSecret) {
    llmStore.removeSecret(webhookSecretId(command.id)).catch(() => {
      // a leftover token is bound to its origin and harmless
    })
  }
}
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
