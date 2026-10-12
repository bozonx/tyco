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

import { useI18n } from '../../composables/use-i18n'
import {
  type MainActionChoice,
  type MainActionGroup,
  buildMainActionOptions,
  commandGroup,
  duplicatesDirectChoice,
  mainActionOptionId,
  pluginActionGroup,
  standardActionGroup,
} from '../../lib/action-menu/main-action-options'
import { normalizeMainActions } from '../../lib/action-menu/main-actions'
import {
  commandLabel,
  isMenuCommand,
  normalizeCommands,
} from '../../lib/commands/command-config'
import { getLanguageLabel } from '../../lib/locale/language'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import { moveShortcutSlot } from '../../lib/shortcut-slots/shortcut-slots'
import { pluginIndexes } from '../../plugins'
import { useActionMenuStore } from '../../stores/action-menu'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'
import { Icon } from '@iconify/vue'
import {
  type CommandConfig,
  type MainActionConfig,
  STANDARD_ACTION_IDS,
  type StandardActionId,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()

const emit = defineEmits<{
  (event: 'update:mainActions', value: (MainActionConfig | null)[]): void
  (event: 'editCommand', commandId: string): void
}>()

const { t } = useI18n()
const actionMenuStore = useActionMenuStore()
const toolsStore = useToolsStore()

const actionSlots = computed(() =>
  normalizeMainActions(props.userConfig.mainActions)
)

const commands = computed(() => normalizeCommands(props.userConfig.commands))

const optionId = mainActionOptionId

/** The AI tasks the menu can refer to: those with a name */
const aiTasks = computed(() =>
  (props.userConfig.aiTasks ?? []).flatMap((task) =>
    task?.id && task.name.trim() ? [task] : []
  )
)

/** The translation languages, and those the slots translate into already */
const languages = computed(() => [
  ...new Set([
    ...(props.userConfig.toTranslateLanguages ?? []).filter(
      (language): language is string => !!language
    ),
    ...actionSlots.value.flatMap((slot) =>
      slot?.type === 'translation' ? [slot.language] : []
    ),
  ]),
])

const slotIds = computed(() => new Set(actionSlots.value.map(optionId)))

/**
 * A command that does what a language or a task of the picker does is left out,
 * unless a slot holds it
 */
const isOffered = (command: CommandConfig) =>
  slotIds.value.has(optionId({ type: 'command', commandId: command.id })) ||
  !duplicatesDirectChoice(command, {
    languages: languages.value,
    rules: aiTasks.value.map((task) => task.rule),
  })

/** Actions that open a dialog to pick what to do are marked as such */
const OPENS_DIALOG = new Set<StandardActionId>(['translation', 'aiTask'])

const availableActions = computed((): MainActionChoice[] => [
  ...Array.from(
    { length: 1 + (props.userConfig.launcherPages?.length ?? 0) },
    (_, page) => ({
      config: { type: 'launcherPage' as const, page },
      name: t('settings.launcherPage', { page: page + 1 }),
      group: { kind: 'commands' as const },
    })
  ),
  ...STANDARD_ACTION_IDS.map((actionId) => ({
    config: { type: 'standard' as const, actionId },
    name: OPENS_DIALOG.has(actionId)
      ? `${t(`action.${actionId}`)}…`
      : t(`action.${actionId}`),
    group: standardActionGroup(actionId),
  })),
  ...languages.value.map((language) => ({
    config: { type: 'translation' as const, language },
    name: t(getLanguageLabel(language)),
    group: { kind: 'translation' as const },
  })),
  ...aiTasks.value.map((task) => ({
    config: { type: 'aiTask' as const, taskId: task.id },
    name: task.name,
    group: { kind: 'aiTask' as const },
  })),
  // plugins offer only the actions they register for this menu
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
              group: pluginActionGroup(action.id),
            },
          ]
        : []
    ),
  // only commands that take the text of the editor fit the menu
  ...commands.value
    .filter(
      (command) => isMenuCommand(command, toolsStore) && isOffered(command)
    )
    .map((command) => ({
      config: { type: 'command' as const, commandId: command.id },
      name: commandLabel(command),
      group: commandGroup(command, toolsStore),
    })),
])

const pluginLabels = computed(
  () =>
    new Map(
      resolveInstalledPlugins(pluginIndexes, props.userConfig).map((plugin) => [
        plugin.name,
        plugin.labelKey ? t(plugin.labelKey) : plugin.label || plugin.name,
      ])
    )
)

function groupLabel(group: MainActionGroup): string {
  switch (group.kind) {
    case 'basic':
      return t('settings.mainActionGroups.basic')
    case 'translation':
      return t('settings.mainActionGroups.translation')
    case 'aiTask':
      return t('settings.mainActionGroups.aiTask')
    case 'commands':
      return t('settings.mainActionGroups.commands')
    case 'unavailable':
      return t('settings.mainActionGroups.unavailable')
    case 'plugin':
      return pluginLabels.value.get(group.plugin) ?? group.plugin
  }
}

/** The name of a slot whose action is not on offer, e.g. a disabled command */
function unavailableName(slot: MainActionConfig): string {
  if (slot.type === 'launcherPage')
    return t('settings.launcherPage', { page: slot.page + 1 })
  if (slot.type === 'aiTask') return t('settings.mainActionTaskRemoved')
  if (slot.type === 'translation') return slot.language
  if (slot.type !== 'command') return slot.actionId
  const command = commands.value.find((item) => item.id === slot.commandId)
  return t('commands.unavailableInMenu', {
    name: command ? commandLabel(command) : slot.commandId,
  })
}

const actionOptions = computed(() =>
  buildMainActionOptions({
    choices: availableActions.value,
    slots: actionSlots.value,
    unavailableName,
    groupLabel,
  })
)

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

  const selected = availableActions.value.find(
    ({ config }) => optionId(config) === value
  )
  if (selected) setSlot(index, selected.config)
}
</script>
