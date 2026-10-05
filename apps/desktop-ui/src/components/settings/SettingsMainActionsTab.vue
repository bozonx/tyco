<template>
  <SettingsSection :description="t('settings.mainActionsHint')" bare>
    <ShortcutSlots
      :items="actionSlots"
      @move="moveAction"
      @add="addAction"
      @remove="removeAction"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :value="optionId(item)"
            :options="actionOptions"
            @update:value="updateAction(index, $event)"
          />
          <Button
            v-if="item.type === 'command'"
            type="button"
            ghost
            square
            sm
            :title="t('commands.editCommand')"
            @click="emit('editCommand', item.commandId)"
          >
            <Icon icon="mdi:pencil-outline" width="16" height="16" />
          </Button>
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { normalizeMainActions } from '../../lib/action-menu/main-actions'
import {
  commandLabel,
  isMenuCommand,
  normalizeCommands,
} from '../../lib/commands/command-config'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { useActionMenuStore } from '../../stores/actionMenu'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import { Icon } from '@iconify/vue'
import {
  type BuiltinToolId,
  type MainActionConfig,
  STANDARD_ACTION_IDS,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
  /** A new command of the library goes to the slot at `index` */
  (event: 'createCommand', index: number, toolId: BuiltinToolId): void
  (event: 'editCommand', commandId: string): void
}>()

const NEW_COMMAND_PREFIX = 'new:'

const { t } = useI18n()
const actionMenuStore = useActionMenuStore()
const toolsStore = useToolsStore()

const actionSlots = computed(() =>
  normalizeMainActions(props.userConfig.mainActions)
)

const commands = computed(() => normalizeCommands(props.userConfig.commands))

const optionId = (item: MainActionConfig | null | undefined): string => {
  if (!item) return ''
  if (item.type === 'command') return `command:${item.commandId}`
  return `${item.type}:${item.actionId}`
}

const availableActions = computed(() => [
  ...STANDARD_ACTION_IDS.map((actionId) => ({
    config: { type: 'standard' as const, actionId },
    name: t(`action.${actionId}`),
  })),
  ...actionMenuStore
    .getRegisteredActions()
    .flatMap((action) =>
      action.id
        ? [
            {
              config: { type: 'plugin' as const, actionId: action.id },
              name: action.labelKey
                ? t(action.labelKey)
                : (action.name ?? action.id),
            },
          ]
        : []
    ),
  // only commands that take the text of the editor fit the menu
  ...commands.value
    .filter((command) => isMenuCommand(command, toolsStore))
    .map((command) => ({
      config: { type: 'command' as const, commandId: command.id },
      name: commandLabel(command),
    })),
])

/** The name of a slot whose action is not on offer, e.g. a disabled command */
function unavailableName(slot: MainActionConfig): string {
  if (slot.type !== 'command') return slot.actionId
  const command = commands.value.find((item) => item.id === slot.commandId)
  return t('commands.unavailableInMenu', {
    name: command ? commandLabel(command) : slot.commandId,
  })
}

const actionOptions = computed(() => {
  const options = [
    ...availableActions.value.map(({ config, name }) => ({
      id: optionId(config),
      name,
    })),
    { id: `${NEW_COMMAND_PREFIX}script`, name: t('commands.newScript') },
    { id: `${NEW_COMMAND_PREFIX}webhook`, name: t('commands.newWebhook') },
  ]
  for (const slot of actionSlots.value) {
    if (slot && !options.some((option) => option.id === optionId(slot))) {
      options.push({ id: optionId(slot), name: unavailableName(slot) })
    }
  }
  return options
})

function moveAction(from: number, to: number) {
  emit('update:mainActions', moveShortcutSlot(actionSlots.value, from, to))
}

function setSlot(index: number, value: MainActionConfig | null) {
  const slots = [...actionSlots.value]
  slots[index] = value
  emit('update:mainActions', slots)
}

function addAction(index: number) {
  setSlot(index, { type: 'standard', actionId: STANDARD_ACTION_IDS[0] })
}

/** Removing a command from the menu keeps it in the library */
function removeAction(index: number) {
  setSlot(index, null)
}

function updateAction(index: number, value: string | number | undefined) {
  if (value === optionId(actionSlots.value[index])) return

  if (value === `${NEW_COMMAND_PREFIX}script`) {
    emit('createCommand', index, 'script')
    return
  }
  if (value === `${NEW_COMMAND_PREFIX}webhook`) {
    emit('createCommand', index, 'webhook')
    return
  }

  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (selected) setSlot(index, selected.config)
}
</script>
