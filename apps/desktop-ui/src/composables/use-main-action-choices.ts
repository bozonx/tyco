import { computed, type Ref } from 'vue'

import {
  type CommandConfig,
  type MainActionConfig,
  PROFILE_ACTION_KINDS,
  STANDARD_ACTION_IDS,
  type StandardActionId,
} from '@tyco/shared'

import {
  type MainActionChoice,
  type MainActionGroup,
  buildMainActionOptions,
  commandGroup,
  duplicatesDirectChoice,
  mainActionOptionId,
  pluginActionGroup,
  standardActionGroup,
} from '../lib/action-menu/main-action-options'
import { isMainActionVisible } from '../lib/action-menu/main-actions'
import {
  chatPromptLabel,
  describeChatPrompts,
} from '../lib/chat-prompts/chat-prompts'
import { normalizeCommands } from '../lib/commands/command-config'
import { commandLabel, isMenuCommand } from '../lib/commands/command-runtime'
import { resolveInstalledPlugins } from '../lib/plugins/plugin-settings'
import { slotList } from '../lib/shortcut-slots/shortcut-slots'
import { translationLanguageLabel } from '../lib/translation/translation-languages'
import { useActionMenuStore } from '../stores/action-menu'
import { useAiProfilesStore } from '../stores/ai-profiles'
import { usePluginRuntimeStore } from '../stores/plugin-runtime'
import { useToolsStore } from '../stores/tools'
import { useI18n } from './use-i18n'
import { useSettingsContext } from './use-settings-context'

const OPENS_DIALOG = new Set<StandardActionId>([
  'translationMenu',
  'transformationMenu',
  'stylingMenu',
  'chatPromptsMenu',
  'favoritesMenu',
  'quickAiRequest',
  'voiceQuickAiRequest',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'voiceCommands',
])

export function useMainActionChoices(
  slots: Ref<readonly (MainActionConfig | null)[]>
) {
  const { t, locale } = useI18n()
  const { draft: userConfig } = useSettingsContext()
  const { pluginFactories } = usePluginRuntimeStore()
  const actionMenuStore = useActionMenuStore()
  const aiProfilesStore = useAiProfilesStore()
  const toolsStore = useToolsStore()

  const commands = computed(() => normalizeCommands(userConfig.value.commands))

  const optionId = mainActionOptionId

  const languages = computed(() => [
    ...new Set([
      ...slotList(userConfig.value.translation.targetLanguages).filter(
        (language): language is string => !!language
      ),
      ...slots.value.flatMap((slot) =>
        slot?.type === 'translation' ? [slot.language] : []
      ),
    ]),
  ])

  const slotIds = computed(() => new Set(slots.value.map(optionId)))

  const transformations = computed(() =>
    userConfig.value.transformations.items.filter((item) => item.name.trim())
  )

  const styling = computed(() =>
    userConfig.value.styling.items.filter((item) => item.name.trim())
  )

  const prompts = computed(() =>
    describeChatPrompts(userConfig.value.chatPrompts.items, {
      profiles: aiProfilesStore.profiles,
      areProfilesLoaded: aiProfilesStore.isLoaded,
    })
  )

  const isOffered = (command: CommandConfig) =>
    slotIds.value.has(optionId({ type: 'command', commandId: command.id })) ||
    !duplicatesDirectChoice(command, {
      languages: languages.value,
      transformations: transformations.value.map((item) => item.rule),
      styling: styling.value.map((item) => item.rule),
    })

  const availableActions = computed((): MainActionChoice[] => [
    ...aiProfilesStore.profiles.flatMap((profile) =>
      PROFILE_ACTION_KINDS.map((action) => ({
        config: { type: 'profile' as const, profileId: profile.id, action },
        name:
          action === 'chat'
            ? t('settings.askInProfileChat', { profile: profile.name })
            : `${t(`action.${action}`)}: ${profile.name}…`,
        group: { kind: 'profile' as const, profileId: profile.id },
      }))
    ),
    ...prompts.value.map((view) => ({
      config: { type: 'chatPrompt' as const, promptId: view.prompt.id },
      name: t('chatPrompts.actionName', { prompt: view.label }),
      group: view.runProfileId
        ? { kind: 'profile' as const, profileId: view.runProfileId }
        : { kind: 'chatPrompts' as const },
    })),
    ...STANDARD_ACTION_IDS.map((actionId) => ({
      config: { type: 'standard' as const, actionId },
      name:
        actionId === 'directCorrection'
          ? t('settings.hotkeyActions.selectionCorrection')
          : actionId === 'openHistory'
            ? t('nav.history')
            : actionId === 'voiceInput'
              ? t('menu.voiceInput')
              : OPENS_DIALOG.has(actionId)
                ? `${t(`action.${actionId}`)}…`
                : t(`action.${actionId}`),
      group: standardActionGroup(actionId),
    })),
    ...languages.value.map((language) => ({
      config: { type: 'translation' as const, language },
      name: translationLanguageLabel(language, locale?.value ?? 'en-US'),
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
      case 'menu':
        return t('nav.menu')
      case 'askAi':
        return t('quickAiRequest.defaultProfile')
      case 'profile': {
        const profile = aiProfilesStore.getProfile(group.profileId)
        return profile
          ? `${t('settings.chatPromptProfile')}: ${profile.name}`
          : t('settings.mainActionGroups.profiles')
      }
      case 'profiles':
        return t('settings.mainActionGroups.profiles')
      case 'chatPrompts':
        return t('settings.mainActionGroups.chatPrompts')
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

  function unavailableName(slot: MainActionConfig): string {
    if (slot.type === 'profileChat') {
      const profile = aiProfilesStore.getProfile(slot.profileId)
      return profile
        ? t('settings.askInProfileChat', { profile: profile.name })
        : t('settings.mainActionProfileRemoved')
    }
    if (slot.type === 'profile') {
      const profile = aiProfilesStore.getProfile(slot.profileId)
      const actionName =
        slot.action === 'chat'
          ? t('action.askInChat')
          : t(`action.${slot.action}`)
      return profile
        ? `${profile.name} — ${actionName}`
        : t('settings.mainActionProfileRemoved')
    }
    if (slot.type === 'transformation')
      return t('settings.mainActionTransformationRemoved')
    if (slot.type === 'styling') return t('settings.mainActionStylingRemoved')
    if (slot.type === 'chatPrompt') {
      const prompt = userConfig.value.chatPrompts.items.find(
        (item) => item.id === slot.promptId
      )
      return prompt
        ? t('chatPrompts.actionName', { prompt: chatPromptLabel(prompt) })
        : t('settings.mainActionPromptRemoved')
    }
    if (slot.type === 'translation') return slot.language
    if (slot.type !== 'command') return slot.actionId
    const command = commands.value.find((item) => item.id === slot.commandId)
    return t('commands.unavailableInMenu', {
      name: command ? commandLabel(command) : slot.commandId,
    })
  }

  const isVisible = (action: MainActionConfig) =>
    isMainActionVisible(action, userConfig.value.isInDevelopment)

  const actionOptions = computed(() =>
    buildMainActionOptions({
      choices: availableActions.value.filter((choice) =>
        isVisible(choice.config)
      ),
      slots: slots.value,
      unavailableName,
      groupLabel,
    })
  )

  return {
    availableActions,
    actionOptions,
    commands,
    toolsStore,
    optionId,
    isVisible,
    groupLabel,
    unavailableName,
  }
}
