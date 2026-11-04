<template>
  <SettingsSection :description="t('settings.actionsHint')" bare>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Button
        v-for="(_, index) in actionPages"
        :key="index"
        size="sm"
        :variant="page === index ? 'primary' : 'neutral'"
        class="min-w-8"
        :title="t('settings.actionPage', { page: index + 1 })"
        :aria-label="t('settings.actionPage', { page: index + 1 })"
        @click="page = index"
      >
        {{ index + 1 }}
      </Button>
      <Button size="sm" @click="addPage">
        {{ t('settings.addActionPage') }}
      </Button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-4 mb-3">
      <div class="flex items-center gap-2">
        <FieldSwitch
          :key="page"
          :model-value="takesText"
          :disabled="page === 0"
          :label="t('settings.actionPageTakesText')"
          @update:model-value="setTakesText"
        />
        <InfoTooltip :text="t('settings.actionPageTakesTextInfo')" />
      </div>
      <Button
        variant="ghost"
        class="ml-auto"
        :disabled="pagesCount <= 1"
        size="sm"
        icon="mdi:trash-can-outline"
        @click="removePage"
        >{{ t('settings.removeActionPage') }}</Button
      >
    </div>
    <ShortcutSlots
      :key="page"
      :items="visibleActionSlots"
      @move="moveAction"
      @add="addAction"
      @remove="removeAction"
    >
      <template #item="{ item, index }">
        <div class="flex items-center gap-2 w-full">
          <FieldSelect
            class="flex-1 min-w-0"
            :model-value="optionId(item)"
            :options="actionOptions"
            @update:model-value="updateAction(index, $event)"
          />
          <IconButton
            v-if="item.type === 'command'"
            variant="ghost"
            size="sm"
            @click="editCommand(item.commandId)"
            :label="t('commands.editCommand')"
            icon="mdi:pencil-outline"
          />
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
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
import {
  isMainActionVisible,
  normalizeMainActions,
} from '../../lib/action-menu/main-actions'
import { normalizeCommands } from '../../lib/commands/command-config'
import { commandLabel, isMenuCommand } from '../../lib/commands/command-runtime'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import {
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../../lib/shortcut-slots/shortcut-slots'
import { translationLanguageLabel } from '../../lib/translation/translation-languages'
import { useActionMenuStore } from '../../stores/action-menu'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { usePluginRuntimeStore } from '../../stores/plugin-runtime'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import {
  type ActionPageConfig,
  type CommandConfig,
  type MainActionConfig,
  STANDARD_ACTION_IDS,
  type StandardActionId,
} from '@tyco/shared'

const { pluginFactories } = usePluginRuntimeStore()

const { t, locale } = useI18n()
const { draft: userConfig, operations, editCommand } = useSettingsContext()
const actionMenuStore = useActionMenuStore()
const aiProfilesStore = useAiProfilesStore()
const toolsStore = useToolsStore()

const page = ref(0)
const actionPages = computed(() => userConfig.value.actionPages ?? [])
const pagesCount = computed(() => actionPages.value.length)

watch(pagesCount, (count) => {
  if (page.value >= count) {
    page.value = Math.max(0, count - 1)
  }
})

function addPage() {
  const pages: ActionPageConfig[] = [
    ...actionPages.value,
    { inputMode: 'selection', slots: {} },
  ]
  operations.updateActionPages(pages)
  page.value = pages.length - 1
}

function removePage() {
  if (pagesCount.value <= 1) return
  operations.updateActionPages(
    actionPages.value.filter((_, index) => index !== page.value)
  )
  page.value = Math.max(0, page.value - 1)
}

const takesText = computed(
  () => page.value === 0 || actionPages.value[page.value]?.inputMode !== 'none'
)

function setTakesText(value: boolean) {
  if (page.value === 0) return
  const pages = actionPages.value.map((item, index) =>
    index === page.value
      ? {
          ...item,
          inputMode: value ? ('selection' as const) : ('none' as const),
        }
      : item
  )
  operations.updateActionPages(pages)
}

const actionSlots = computed(() =>
  normalizeMainActions(actionPages.value[page.value]?.slots)
)

const isVisible = (action: MainActionConfig) =>
  isMainActionVisible(action, userConfig.value.isInDevelopment)
const visibleActionSlots = computed(() =>
  actionSlots.value.map((action) =>
    action && isVisible(action) ? action : null
  )
)

const commands = computed(() => normalizeCommands(userConfig.value.commands))

const optionId = mainActionOptionId

/** The translation languages, and those the slots translate into already */
const languages = computed(() => [
  ...new Set([
    ...slotList(userConfig.value.translation.targetLanguages).filter(
      (language): language is string => !!language
    ),
    ...actionSlots.value.flatMap((slot) =>
      slot?.type === 'translation' ? [slot.language] : []
    ),
  ]),
])

const slotIds = computed(() => new Set(actionSlots.value.map(optionId)))

const transformations = computed(() =>
  userConfig.value.transformations.items.filter((item) => item.name.trim())
)

const styling = computed(() =>
  userConfig.value.styling.items.filter((item) => item.name.trim())
)

/**
 * A command that does what a language or a task of the picker does is left out,
 * unless a slot holds it
 */
const isOffered = (command: CommandConfig) =>
  slotIds.value.has(optionId({ type: 'command', commandId: command.id })) ||
  !duplicatesDirectChoice(command, {
    languages: languages.value,
    transformations: transformations.value.map((item) => item.rule),
    styling: styling.value.map((item) => item.rule),
  })

/** Actions that open a dialog to pick what to do are marked as such */
const OPENS_DIALOG = new Set<StandardActionId>([
  'translationMenu',
  'transformationMenu',
  'stylingMenu',
  'chatPromptsMenu',
  'snippetsMenu',
  'quickAiRequest',
  'voiceQuickAiRequest',
  'voiceCommands',
])

const availableActions = computed((): MainActionChoice[] => [
  ...aiProfilesStore.profiles.map((profile) => ({
    config: { type: 'profileChat' as const, profileId: profile.id },
    name: t('settings.askInProfileChat', { profile: profile.name }),
    group: { kind: 'profiles' as const },
  })),
  ...STANDARD_ACTION_IDS.map((actionId) => ({
    config: { type: 'standard' as const, actionId },
    name: OPENS_DIALOG.has(actionId)
      ? `${t(`action.${actionId}`)}…`
      : t(`action.${actionId}`),
    group: standardActionGroup(actionId),
  })),
  ...languages.value.map((language) => ({
    config: { type: 'translation' as const, language },
    name: translationLanguageLabel(language, locale.value),
    group: { kind: 'translation' as const },
  })),
  ...transformations.value.map((item) => ({
    config: { type: 'transformation' as const, transformationId: item.id },
    name: item.name,
    group: { kind: 'transformation' as const },
  })),
  ...styling.value.map((item) => ({
    config: { type: 'styling' as const, stylingId: item.id },
    name: item.name,
    group: { kind: 'styling' as const },
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
                : (action.label ?? action.name ?? action.id),
              group: pluginActionGroup(action.id, action.ownerPluginId),
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
      resolveInstalledPlugins(pluginFactories, userConfig.value).map(
        (plugin) => [
          plugin.pluginId,
          plugin.labelKey
            ? t(plugin.labelKey)
            : plugin.label || plugin.pluginId,
        ]
      )
    )
)

function groupLabel(group: MainActionGroup): string {
  switch (group.kind) {
    case 'basic':
      return t('settings.mainActionGroups.basic')
    case 'profiles':
      return t('settings.mainActionGroups.profiles')
    case 'translation':
      return t('settings.mainActionGroups.translation')
    case 'aiCommands':
      return t('settings.mainActionGroups.aiCommands')
    case 'transformation':
      return t('settings.mainActionGroups.transformation')
    case 'styling':
      return t('settings.mainActionGroups.styling')
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
  if (slot.type === 'profileChat') {
    const profile = aiProfilesStore.getProfile(slot.profileId)
    return profile
      ? t('settings.askInProfileChat', { profile: profile.name })
      : t('settings.mainActionProfileRemoved')
  }
  if (slot.type === 'transformation')
    return t('settings.mainActionTransformationRemoved')
  if (slot.type === 'styling') return t('settings.mainActionStylingRemoved')
  if (slot.type === 'translation') return slot.language
  if (slot.type !== 'command') return slot.actionId
  const command = commands.value.find((item) => item.id === slot.commandId)
  return t('commands.unavailableInMenu', {
    name: command ? commandLabel(command) : slot.commandId,
  })
}

const actionOptions = computed(() =>
  buildMainActionOptions({
    choices: availableActions.value.filter((choice) =>
      isVisible(choice.config)
    ),
    slots: visibleActionSlots.value,
    unavailableName,
    groupLabel,
  })
)

function updatePageSlots(slots: (MainActionConfig | null)[]) {
  const pages = actionPages.value.map((item, index) =>
    index === page.value ? { ...item, slots: slotsFromList(slots) } : item
  )
  operations.updateActionPages(pages)
}

function moveAction(from: number, to: number) {
  updatePageSlots(moveShortcutSlot(actionSlots.value, from, to))
}

function setSlot(index: number, value: MainActionConfig | null) {
  const slots = [...actionSlots.value]
  slots[index] = value
  updatePageSlots(slots)
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
