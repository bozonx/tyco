<template>
  <SettingsSection :description="t('settings.launcherCommandsHint')" bare>
    <ShortcutSlots
      :items="launcherSlots"
      @move="moveSlot"
      @add="addSlot"
      @remove="removeSlot"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :value="item ?? ''"
            :options="commandOptions"
            @update:value="updateSlot(index, $event)"
          />
          <Button
            v-if="item"
            type="button"
            ghost
            square
            sm
            :title="t('commands.editCommand')"
            @click="emit('editCommand', item)"
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
import {
  commandLabel,
  isCommandAvailable,
  normalizeCommands,
  normalizeLauncherCommands,
} from '../../lib/commands/command-config'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import { Icon } from '@iconify/vue'
import type { BuiltinToolId, UserConfig } from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:launcherCommands', value: (string | null)[]): void
  /** A new command of the library goes to the slot at `index` */
  (event: 'createCommand', index: number, toolId: BuiltinToolId): void
  (event: 'editCommand', commandId: string): void
}>()

const NEW_COMMAND_PREFIX = 'new:'

const { t } = useI18n()
const toolsStore = useToolsStore()

const commands = computed(() => normalizeCommands(props.userConfig.commands))

const launcherSlots = computed(() =>
  normalizeLauncherCommands(props.userConfig.launcherCommands, commands.value)
)

const availableCommands = computed(() =>
  commands.value.map((command) => ({
    id: command.id,
    name: commandLabel(command),
    available: isCommandAvailable(command, toolsStore),
  }))
)

function unavailableName(commandId: string): string {
  const command = commands.value.find((item) => item.id === commandId)
  return t('commands.unavailableInMenu', {
    name: command ? commandLabel(command) : commandId,
  })
}

const commandOptions = computed(() => {
  const options = [
    ...availableCommands.value.map(({ id, name }) => ({ id, name })),
    { id: `${NEW_COMMAND_PREFIX}script`, name: t('commands.newScript') },
    { id: `${NEW_COMMAND_PREFIX}webhook`, name: t('commands.newWebhook') },
  ]
  for (const commandId of launcherSlots.value) {
    if (commandId && !options.some((option) => option.id === commandId)) {
      options.push({ id: commandId, name: unavailableName(commandId) })
    }
  }
  return options
})

function moveSlot(from: number, to: number) {
  emit(
    'update:launcherCommands',
    moveShortcutSlot(launcherSlots.value, from, to)
  )
}

function setSlot(index: number, value: string | null) {
  const slots = [...launcherSlots.value]
  slots[index] = value
  emit('update:launcherCommands', slots)
}

function addSlot(index: number) {
  const first = availableCommands.value[0]?.id ?? null
  setSlot(index, first)
}

function removeSlot(index: number) {
  setSlot(index, null)
}

function updateSlot(index: number, value: string | number | undefined) {
  const current = launcherSlots.value[index]
  if (value === current) return

  if (value === `${NEW_COMMAND_PREFIX}script`) {
    emit('createCommand', index, 'script')
    return
  }
  if (value === `${NEW_COMMAND_PREFIX}webhook`) {
    emit('createCommand', index, 'webhook')
    return
  }

  setSlot(index, typeof value === 'string' && value ? value : null)
}
</script>
