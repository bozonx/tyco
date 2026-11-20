<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.commandsTab')"
      :info="t('commands.hint')"
      bare
    >
      <template #actions>
        <Button
          variant="primary"
          class="add-btn"
          size="sm"
          icon="mdi:plus"
          :aria-expanded="isCreateModalOpen"
          @click="isCreateModalOpen = true"
        >
          {{ t('commands.create') }}
        </Button>
      </template>
      <div class="commands-tab">
        <SettingsCreateCommandModal
          :open="isCreateModalOpen"
          :tools="availableTools"
          @close="isCreateModalOpen = false"
          @submit="handleCreateCommand"
        />
        <ConfirmModal
          :open="Boolean(commandToDelete)"
          :title="t('commands.deleteConfirmTitle')"
          :message="
            t('commands.deleteConfirmMessage', { name: commandToDeleteName })
          "
          :confirm-text="t('common.delete')"
          danger
          @confirm="confirmDeleteCommand"
          @cancel="commandToDelete = null"
        />
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
                !command.isEnabled || Boolean(getUnavailableReasonKey(command)),
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
              :name-conflicts="nameConflicts.get(command.id) ?? []"
              @toggle="toggle(command.id)"
              @drag="startDrag(index, $event)"
              @update="updateCommand(index, $event)"
              @navigate="navigate"
              @copy-id="copyId(command)"
              @remove="requestDeleteCommand(command)"
            />
          </div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('commands.aiTitle')"
      :info="t('commands.aiDescription')"
    >
      <SettingsTaskModel task="aiTask" />
    </SettingsSection>

    <SettingsSection
      :title="t('commands.externalTitle')"
      :info="t('commands.externalDescription')"
    >
      <FieldRow
        :label="t('commands.externalSelection')"
        :info="t('commands.externalSelectionInfo')"
        device-scoped
      >
        <FieldSwitch
          :model-value="externalAccess.canAccessSelection"
          :title="t('commands.externalSelection')"
          @update:model-value="setExternalAccess('canAccessSelection', $event)"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance, computed, nextTick, ref } from 'vue'

import { useCopyValue } from '../../composables/use-copy-value'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSortableList } from '../../composables/use-sortable-list'
import useToast from '../../composables/use-toast'
import {
  createCommand,
  normalizeCommands,
} from '../../lib/commands/command-config'
import { isCommandOperation } from '../../lib/commands/command-config'
import { externalCommandNameConflicts } from '../../lib/commands/command-external'
import { createCommandRemovalModel } from '../../lib/commands/command-removal-model'
import { commandUnavailableReason } from '../../lib/commands/command-runtime'
import { clientLogger } from '../../lib/logger'
import { operationLabel } from '../../lib/operations/operation-label'
import { slotList } from '../../lib/shortcut-slots/shortcut-slots'
import { moveItem } from '../../lib/sortable/sortable-list'
import { useDesktopStore } from '../../stores/desktop'
import { useOperationsStore } from '../../stores/operations'
import { useSecretsStore } from '../../stores/secrets'
import { useSettingsSessionStore } from '../../stores/settings-session'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import StateMessage from '../common/StateMessage.vue'
import CommandCard from './CommandCard.vue'
import SettingsCreateCommandModal, {
  type CreateCommandSubmitEvent,
} from './SettingsCreateCommandModal.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
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
const { toastKey, toastError } = useToast()
const desktopStore = useDesktopStore()
const secretsStore = useSecretsStore()
const operationsStore = useOperationsStore()

const externalAccess = computed<ExternalAccess>(() => ({
  canAccessSelection:
    userConfig.value.externalAccess?.canAccessSelection ??
    DEFAULT_EXTERNAL_ACCESS.canAccessSelection,
}))
const setExternalAccess = (key: keyof ExternalAccess, value: boolean) => {
  userConfig.value.externalAccess = { ...externalAccess.value, [key]: value }
}

const setCommands = (next: CommandConfig[]) => {
  userConfig.value.commands = next
}
const commands = computed(() => normalizeCommands(userConfig.value.commands))
/** The other commands an external call by the name of each one could mean */
const nameConflicts = computed(() =>
  externalCommandNameConflicts(commands.value, operationsStore)
)

/** The first slot of the action menu that holds each command (page 0) */
const menuSlots = computed(() => {
  const slots = new Map<string, number>()
  const firstPage = userConfig.value.actionPages?.[0]
  if (firstPage?.slots) {
    slotList(firstPage.slots).forEach((slot, index) => {
      if (slot?.type === 'command' && !slots.has(slot.commandId)) {
        slots.set(slot.commandId, index)
      }
    })
  }
  return slots
})

/** Every action page (> 0) and key assigned to each command. */
const launcherSlots = computed(() => {
  const slots = new Map<string, { page: number; index: number }[]>()
  const pages = (userConfig.value.actionPages ?? []).slice(1)
  pages.forEach((pageConfig, pageIndex) => {
    slotList(pageConfig.slots).forEach((slot, index) => {
      if (slot?.type !== 'command') return
      const id = slot.commandId
      const placements = slots.get(id) ?? []
      placements.push({ page: pageIndex + 1, index })
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
  commandUnavailableReason(command, operationsStore)

const isCreateModalOpen = ref(false)

/** The tools a command can be created from */
const availableTools = computed(() =>
  operationsStore
    .list()
    .filter((tool) => isCommandOperation(tool))
    .map((tool) => ({
      id: tool.id,
      name: operationLabel(tool, t),
      description: tool.descriptionKey
        ? t(tool.descriptionKey)
        : tool.description,
      icon: tool.icon,
    }))
)

function handleCreateCommand(event: CreateCommandSubmitEvent) {
  isCreateModalOpen.value = false
  const tool = operationsStore.get(event.operationId)
  const command = createCommand(
    event.operationId,
    undefined,
    tool,
    desktopStore.userData?.platform
  )

  focusedCommandId.value = command.id
  setCommands([command, ...commands.value])
  expanded.value = new Set([command.id, ...expanded.value])
  void reveal(command.id)
}

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

function updateCommand(index: number, command: CommandConfig) {
  const next = [...commands.value]
  next[index] = command
  setCommands(next)
}

const settingsSession = useSettingsSessionStore()
const { removeCommand } = createCommandRemovalModel({
  getCommands: () => commands.value,
  getActionPages: () => userConfig.value.actionPages ?? [],
  updateCommands: setCommands,
  updateActionPages: (pages) => {
    userConfig.value.actionPages = pages
  },
  getCustomActionSlots: () => userConfig.value.customActionSlots,
  updateCustomActionSlots: (slots) => {
    userConfig.value.customActionSlots = slots
  },
  removeSecret: (id) => secretsStore.removeSecret(id),
  persist: settingsSession.persist,
  isSaved: settingsSession.isSaved,
  notifyError: (error) => {
    clientLogger.error('Could not remove command secrets', {
      error: String(error),
    })
    toastError(error, 'settings.keyRemoveFailed')
  },
})

const commandToDelete = ref<CommandConfig | null>(null)
const commandToDeleteName = computed(
  () => commandToDelete.value?.name.trim() || t('commands.unnamed')
)

function requestDeleteCommand(command: CommandConfig) {
  commandToDelete.value = command
}

function confirmDeleteCommand() {
  const command = commandToDelete.value
  commandToDelete.value = null
  if (!command) return
  if (focusedCommandId.value === command.id) {
    focusedCommandId.value = null
  }
  removeCommand(command)
}
</script>

<style scoped>
.commands-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
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
