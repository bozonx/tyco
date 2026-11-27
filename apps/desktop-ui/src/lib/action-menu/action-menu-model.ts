import { computed, ref } from 'vue'

import type { CorrectionStepExtra } from '../correction/correction-step'
import type { ActionItem } from '../../types/plugins'
import { createContributionRegistry } from '../plugins/contribution-registry'
import { describeChatPrompt } from '../chat-prompts/chat-prompts'

import {
  APP_CONFIG,
  type ActionPageConfig,
  type ChatPromptConfig,
  type CommandConfig,
  type CoreOperationId,
  type MainActionConfig,
  type ProfileActionKind,
  type ShortcutSlots,
  type StandardActionId,
} from '@tyco/shared'

import {
  commandLabel,
  commandTakesText,
  isMenuCommand,
} from '../commands/command-runtime'
import { i18n, translate } from '../i18n'
import { messages } from '../i18n/messages'
import { translationLanguageLabel } from '../translation/translation-languages'
import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
} from '../invocation/invocation-runner'
import { getLanguageLabelKey } from '../locale/language'
import { normalizeMainActions } from './main-actions'
import { validateActionText } from './action-text-requirement'
import { configProfileKey } from '../ai-profiles/profile-ref'

export type { ActionItem } from '../../types/plugins'
export interface ActionMenuDependencies extends InvocationRunnerDependencies {
  /** Records a text that leaves the app; runs before the window closes. */
  saveOutput: (text: string) => Promise<void>
  reportError?: (error: unknown) => void
  /**
   * Runs a library command in the command overlay; `text` is null when the
   * overlay has to ask for it
   */
  startCommandRun: (commandId: string, text: string | null) => Promise<unknown>
  openTransformationModal?: (text: string, transformationId?: string) => void
  openQuickAiRequestModal?: (
    text: string,
    inputMode?: 'text' | 'voice',
    profileId?: string | null
  ) => void
  openVoiceCommandsModal?: (
    text: string,
    inputMode: 'selection' | 'none'
  ) => void
  openStylingModal?: (text: string, stylingId?: string) => void
  openChatPromptsModal?: (text: string) => void
  /** Opens the quick AI request with `prompt`, in the profile, if any */
  openChatPrompt?: (
    text: string,
    prompt: string,
    profileId: string | null
  ) => void
  openFavoritesModal?: () => void
  activateMode?: (
    mode:
      | 'editor'
      | 'history'
      | 'dialog'
      | 'voice'
      | 'listen'
      | 'screenshotQuickAiRequest'
      | 'voiceScreenshotQuickAiRequest',
    profileId?: string
  ) => Promise<void>
  openVoiceInput?: (text: string) => Promise<void>
  canListen?: () => boolean
  /** With `language` the dialog translates into it at once */
  openTranslateModal: (text: string, language?: string) => void
  /** `extra` goes to the params of the correction step, see `InsertMenu` */
  startCorrection: (text: string, extra?: CorrectionStepExtra) => Promise<void>
  correctAndInsert?: (text: string) => Promise<void>
  minCorrectionLength?: () => number
  isMainActionVisible?: (action: MainActionConfig) => boolean
  actionPages?: () => readonly ActionPageConfig[] | undefined
  mainActions?: () => ShortcutSlots<MainActionConfig> | undefined
  /** The command library the menu items of the `command` type refer to */
  commands?: () => readonly CommandConfig[] | undefined
  transformations?: () => readonly { id: string; name: string }[] | undefined
  styling?: () => readonly { id: string; name: string }[] | undefined
  profiles?: () => readonly { id: string; name: string }[] | undefined
  /**
   * The attached vaults that are there now: a slot of a profile of another one
   * is hidden and takes no place until its vault is back
   */
  connectedVaultIds?: () => readonly string[]
  /** Whether `profiles` is known; until then a prompt keeps its profile */
  areProfilesLoaded?: () => boolean
  /** The prompt library the items of the `chatPrompt` type refer to */
  chatPrompts?: () => readonly ChatPromptConfig[] | undefined
  openProfileChat?: (
    profileId: string,
    text: string,
    newChat?: boolean
  ) => Promise<void> | void
  openActionPage?: (pageIndex: number, text?: string) => Promise<void> | void
}

export function createActionMenuModel(deps: ActionMenuDependencies) {
  const registry = createContributionRegistry<ActionItem>()
  const registeredActionsMenu = registry.items
  const invocationRunner = createInvocationRunner(deps)

  /**
   * The menu item of a built-in action that runs a core tool as it is: it needs
   * no command of the library. `leavesApp` records the text before it goes
   */
  const createBuiltinActionItem = (
    item: Required<Pick<ActionItem, 'id' | 'labelKey' | 'icon'>>,
    operationId: CoreOperationId,
    leavesApp: boolean,
    notifySuccess?: boolean
  ): ActionItem => ({
    ...item,
    action: async (text: string) => {
      if (!text?.trim()) {
        deps.showToast('toast.textNotSelected', 'error')
        return
      }
      if (leavesApp) await deps.saveOutput(text)
      await invocationRunner.run(
        { operationId, operationConfig: {}, label: translate(item.labelKey) },
        text,
        {
          source: 'menu',
          ...(notifySuccess !== undefined ? { notifySuccess } : {}),
        }
      )
    },
  })

  /**
   * The menu item of a command: it runs in the command overlay, which asks for
   * the text when the command takes one and the menu has none
   */
  const createCommandActionItem = (command: CommandConfig): ActionItem => ({
    id: `command:${command.id}`,
    name: commandLabel(command),
    icon: 'mdi:console-line',
    action: async (text: string) => {
      const takesText = commandTakesText(command, deps.operations)
      await deps.startCommandRun(
        command.id,
        takesText && text?.trim() ? text : null
      )
    },
  })

  /** Runs `action` on the text, validating text requirements */
  const withText =
    (actionId: string, action: (text: string) => void) =>
    async (text: string): Promise<void> => {
      const check = validateActionText(actionId, text, {
        minCorrectionLength:
          deps.minCorrectionLength?.() ?? APP_CONFIG.minCorrectionLength,
      })
      if (!check.valid) {
        deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
        return
      }
      action(text)
    }

  const createTransformationActionItem = (
    transformationId: string
  ): ActionItem | undefined => {
    const item = deps
      .transformations?.()
      ?.find((t) => t.id === transformationId)
    if (!item?.name) return undefined
    return {
      id: `transformation:${transformationId}`,
      name: item.name,
      icon: 'mdi:auto-fix',
      action: withText(`transformation:${transformationId}`, (text) =>
        deps.openTransformationModal?.(text, transformationId)
      ),
    }
  }

  const createStylingActionItem = (
    stylingId: string
  ): ActionItem | undefined => {
    const item = deps.styling?.()?.find((s) => s.id === stylingId)
    if (!item?.name) return undefined
    return {
      id: `styling:${stylingId}`,
      name: item.name,
      icon: 'mdi:palette-outline',
      action: withText(`styling:${stylingId}`, (text) =>
        deps.openStylingModal?.(text, stylingId)
      ),
    }
  }

  /** A prompt opens the quick AI request with it, with or without text */
  const createChatPromptActionItem = (
    promptId: string
  ): ActionItem | undefined => {
    const prompt = deps.chatPrompts?.()?.find((item) => item.id === promptId)
    if (!prompt?.rule.trim()) return undefined
    const view = describeChatPrompt(prompt, {
      profiles: deps.profiles?.() ?? [],
      areProfilesLoaded: deps.areProfilesLoaded?.() ?? true,
    })
    return {
      id: `chatPrompt:${promptId}`,
      name: view.label,
      icon: 'mdi:lightning-bolt-outline',
      action: async (text: string) => {
        deps.openChatPrompt?.(text ?? '', prompt.rule.trim(), view.runProfileId)
      },
    }
  }

  const createTranslationActionItem = (language: string): ActionItem => ({
    id: `translation:${language}`,
    ...(Object.hasOwn(messages['en-US'].language, language)
      ? { labelKey: getLanguageLabelKey(language) }
      : { name: translationLanguageLabel(language, i18n.global.locale.value) }),
    icon: 'mdi:translate',
    action: withText(`translation:${language}`, (text) =>
      deps.openTranslateModal(text, language)
    ),
  })

  const createProfileChatActionItem = (
    profileId: string
  ): ActionItem | undefined => {
    const profile = deps.profiles?.()?.find((p) => p.id === profileId)
    if (!profile) return undefined
    return {
      id: `profileChat:${profileId}`,
      name: `${translate('action.askInCurrentChat')}: ${profile.name}`,
      icon: 'mdi:chat-question-outline',
      action: async (text: string) => {
        await deps.openProfileChat?.(profileId, text)
      },
    }
  }

  const createProfileActionItem = (
    profileId: string,
    action: ProfileActionKind
  ): ActionItem | undefined => {
    const profile = deps.profiles?.()?.find((p) => p.id === profileId)
    if (!profile) return undefined
    const baseId = `profile:${profileId}:${action}`
    switch (action) {
      case 'quickAiRequest':
        return {
          id: baseId,
          name: `${translate('action.quickAiRequest')}: ${profile.name}`,
          icon: 'mdi:pencil-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openQuickAiRequestModal?.(text, 'text', profileId)
          },
        }
      case 'voiceQuickAiRequest':
        return {
          id: baseId,
          name: `${translate('action.voiceQuickAiRequest')}: ${profile.name}`,
          icon: 'mdi:microphone-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openQuickAiRequestModal?.(text, 'voice', profileId)
          },
        }
      case 'screenshotQuickAiRequest':
        return {
          id: baseId,
          name: `${translate('action.screenshotQuickAiRequest')}: ${profile.name}`,
          icon: 'mdi:monitor-screenshot',
          action: async () => {
            await deps.activateMode?.('screenshotQuickAiRequest', profileId)
          },
        }
      case 'voiceScreenshotQuickAiRequest':
        return {
          id: baseId,
          name: `${translate('action.voiceScreenshotQuickAiRequest')}: ${profile.name}`,
          icon: 'mdi:monitor-screenshot',
          action: async () => {
            await deps.activateMode?.(
              'voiceScreenshotQuickAiRequest',
              profileId
            )
          },
        }
      case 'chat':
      case 'askInNewChat': {
        const newChat = action === 'askInNewChat'
        return {
          id: baseId,
          name: `${translate(newChat ? 'action.askInNewChat' : 'action.askInCurrentChat')}: ${profile.name}`,
          icon: newChat ? 'mdi:chat-plus-outline' : 'mdi:chat-question-outline',
          action: async (text: string) => {
            await deps.openProfileChat?.(profileId, text, newChat)
          },
        }
      }
    }
  }

  const createActionPageActionItem = (
    targetIndex: number
  ): ActionItem | undefined => {
    const pages = deps.actionPages?.()
    if (pages && targetIndex >= pages.length) return undefined
    return {
      id: `actionPage:${targetIndex}`,
      name: translate('settings.actionPage', { page: targetIndex + 1 }),
      icon: 'mdi:book-open-page-variant-outline',
      trailingIcon: 'mdi:chevron-right',
      action: async (text: string) => {
        if (deps.openActionPage) {
          await deps.openActionPage(targetIndex, text)
        } else {
          openPage(targetIndex)
        }
      },
    }
  }

  /** Corrects `text` on a step of its own, unless it is empty or too short. */
  const correct = async (
    text: string,
    extra?: CorrectionStepExtra
  ): Promise<void> => {
    const check = validateActionText('correction', text, {
      minCorrectionLength:
        deps.minCorrectionLength?.() ?? APP_CONFIG.minCorrectionLength,
    })
    if (!check.valid) {
      deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
      return
    }
    await deps.startCorrection(text, extra)
  }

  const getDefaultActions = (): ActionItem[] =>
    (
      [
        createBuiltinActionItem(
          {
            id: 'insertIntoWindow',
            labelKey: 'action.insertIntoWindow',
            icon: 'mdi:application-export',
          },
          'core.insert',
          true
        ),
        createBuiltinActionItem(
          {
            id: 'copyToClipboard',
            labelKey: 'action.copyToClipboard',
            icon: 'mdi:clipboard-arrow-right-outline',
          },
          'core.copy',
          true,
          false
        ),
        {
          id: 'transformationMenu',
          labelKey: 'action.transformationMenu',
          icon: 'mdi:auto-fix',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            const check = validateActionText('transformationMenu', text)
            if (!check.valid) {
              deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
              return
            }
            deps.openTransformationModal?.(text)
          },
        },
        {
          id: 'quickAiRequest',
          labelKey: 'action.quickAiRequest',
          icon: 'mdi:pencil-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openQuickAiRequestModal?.(text, 'text')
          },
        },
        {
          id: 'voiceQuickAiRequest',
          labelKey: 'action.voiceQuickAiRequest',
          icon: 'mdi:microphone-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openQuickAiRequestModal?.(text, 'voice')
          },
        },
        {
          id: 'screenshotQuickAiRequest',
          labelKey: 'action.screenshotQuickAiRequest',
          icon: 'mdi:monitor-screenshot',
          action: async () => {
            await deps.activateMode?.('screenshotQuickAiRequest')
          },
        },
        {
          id: 'voiceScreenshotQuickAiRequest',
          labelKey: 'action.voiceScreenshotQuickAiRequest',
          icon: 'mdi:monitor-screenshot',
          action: async () => {
            await deps.activateMode?.('voiceScreenshotQuickAiRequest')
          },
        },
        {
          id: 'voiceCommands',
          labelKey: 'action.voiceCommands',
          icon: 'mdi:microphone',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openVoiceCommandsModal?.(
              text,
              takesText.value ? 'selection' : 'none'
            )
          },
        },
        {
          id: 'stylingMenu',
          labelKey: 'action.stylingMenu',
          icon: 'mdi:palette-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            const check = validateActionText('stylingMenu', text)
            if (!check.valid) {
              deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
              return
            }
            deps.openStylingModal?.(text)
          },
        },
        {
          id: 'chatPromptsMenu',
          labelKey: 'action.chatPromptsMenu',
          icon: 'mdi:lightning-bolt-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            deps.openChatPromptsModal?.(text ?? '')
          },
        },
        {
          id: 'openEditor',
          labelKey: 'nav.editor',
          icon: 'mdi:file-document-edit-outline',
          action: async () => {
            await deps.activateMode?.('editor')
          },
        },
        {
          id: 'openHistory',
          labelKey: 'nav.history',
          icon: 'mdi:history',
          action: async () => {
            await deps.activateMode?.('history')
          },
        },
        {
          id: 'openDialog',
          labelKey: 'nav.dialog',
          icon: 'mdi:account-voice',
          action: async () => {
            await deps.activateMode?.('dialog')
          },
        },
        {
          id: 'voiceInput',
          labelKey: 'menu.voiceInput',
          icon: 'mdi:microphone-outline',
          action: async (text: string) => {
            await deps.openVoiceInput?.(text)
          },
        },
        {
          id: 'listen',
          labelKey: 'listen.title',
          icon: 'mdi:volume-high',
          ...(deps.canListen && !deps.canListen()
            ? { disabled: true, hint: translate('listen.unavailable') }
            : {}),
          action: async () => {
            await deps.activateMode?.('listen')
          },
        },
        {
          id: 'favoritesMenu',
          labelKey: 'action.favoritesMenu',
          icon: 'mdi:card-text-outline',
          trailingIcon: 'mdi:chevron-right',
          action: async () => {
            deps.openFavoritesModal?.()
          },
        },
        {
          id: 'directCorrection',
          labelKey: 'settings.hotkeyActions.selectionCorrection',
          icon: 'mdi:spellcheck',
          action: async (text: string) => {
            const check = validateActionText('directCorrection', text, {
              minCorrectionLength:
                deps.minCorrectionLength?.() ?? APP_CONFIG.minCorrectionLength,
            })
            if (!check.valid) {
              deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
              return
            }
            await deps.correctAndInsert?.(text)
          },
        },
        {
          id: 'correction',
          labelKey: 'action.correction',
          icon: 'mdi:spellcheck',
          action: (text: string) => correct(text),
        },
        {
          id: 'translationMenu',
          labelKey: 'action.translationMenu',
          icon: 'mdi:translate',
          trailingIcon: 'mdi:chevron-right',
          action: async (text: string) => {
            const check = validateActionText('translationMenu', text)
            if (!check.valid) {
              deps.showToast(check.toastKey!, check.toastKind ?? 'warn')
              return
            }
            deps.openTranslateModal(text)
          },
        },
        {
          id: 'askInCurrentChat',
          labelKey: 'action.askInCurrentChat',
          icon: 'mdi:chat-outline',
          action: async (text: string) => {
            await invocationRunner.run(
              {
                operationId: 'core.askInCurrentChat',
                operationConfig: {},
                label: translate('action.askInCurrentChat'),
              },
              text,
              { source: 'menu' }
            )
          },
        },
        {
          id: 'askInNewChat',
          labelKey: 'action.askInNewChat',
          icon: 'mdi:chat-plus-outline',
          action: async (text: string) => {
            await invocationRunner.run(
              {
                operationId: 'core.askInNewChat',
                operationConfig: {},
                label: translate('action.askInNewChat'),
              },
              text,
              { source: 'menu' }
            )
          },
        },
      ] satisfies ActionItem[]
    ).filter(
      (action) =>
        !deps.isMainActionVisible ||
        deps.isMainActionVisible({
          type: 'standard',
          actionId: action.id as StandardActionId,
        })
    )

  const getRegisteredActions = registry.list

  const pageIndex = ref(0)
  const lastRequestedPageIndex = ref(0)
  const pageCount = computed(() =>
    Math.max(1, deps.actionPages?.()?.length ?? 1)
  )
  const currentPage = computed(
    () => deps.actionPages?.()?.[pageIndex.value] ?? deps.actionPages?.()?.[0]
  )
  /** The first page always acts on text; another may be set to take none. */
  const pageTakesText = (index: number) =>
    index === 0 || deps.actionPages?.()?.[index]?.inputMode !== 'none'
  const takesText = computed(() => pageTakesText(pageIndex.value))
  /** Pages whose actions can run on a result text, in page order. */
  const textPageIndexes = computed(() =>
    Array.from({ length: pageCount.value }, (_, index) => index).filter(
      pageTakesText
    )
  )

  const clampPage = (index: number) => {
    if (index < 0 || index >= pageCount.value) {
      return 0
    }
    return index
  }
  const setPage = (index: number) => {
    pageIndex.value = clampPage(index)
  }
  const openPage = (index: number) => {
    lastRequestedPageIndex.value = index
    setPage(index)
  }
  const nextPage = () => {
    pageIndex.value = (pageIndex.value + 1) % pageCount.value
  }
  const prevPage = () => {
    pageIndex.value = (pageIndex.value - 1 + pageCount.value) % pageCount.value
  }
  /**
   * Steps to the previous or the next page among `indexes`, wrapping around;
   * from a page outside them it goes to the first one.
   */
  const stepPageWithin = (indexes: readonly number[], direction: 1 | -1) => {
    if (indexes.length === 0) return
    const position = indexes.indexOf(pageIndex.value)
    if (position < 0) {
      pageIndex.value = indexes[0]
      return
    }
    const next = (position + direction + indexes.length) % indexes.length
    pageIndex.value = indexes[next]
  }
  /**
   * Handles an action-page hotkey or command while the action menu is already
   * open: repeating the last requested page or asking for the page already
   * shown steps to the next page; asking for another page opens it directly.
   */
  const repeatOpenPage = (index: number) => {
    const previous = lastRequestedPageIndex.value
    lastRequestedPageIndex.value = index
    const target = clampPage(index)
    if (index !== previous && target !== pageIndex.value) {
      pageIndex.value = target
    } else {
      nextPage()
    }
  }

  const resolveMainActions = (
    config?: unknown,
    targetPageIndex = pageIndex.value
  ) => {
    const pages = deps.actionPages?.()
    const resolvedConfig =
      config ??
      (pages && pages.length > 0
        ? pages[targetPageIndex]?.slots
        : deps.mainActions?.())
    return normalizeMainActions(resolvedConfig).map((action) =>
      action && deps.isMainActionVisible && !deps.isMainActionVisible(action)
        ? null
        : action
    )
  }

  const resolveActionItem = (
    item: MainActionConfig | null | undefined
  ): ActionItem | undefined => {
    if (!item) return undefined
    const defaults = new Map(
      getDefaultActions().map((action) => [action.id, action])
    )
    const plugins = new Map(
      registeredActionsMenu.value.map((action) => [action.id, action])
    )
    const commands = new Map(
      (deps.commands?.() ?? []).map((command) => [command.id, command])
    )
    if (item.type === 'standard') return defaults.get(item.actionId)
    if (item.type === 'plugin') return plugins.get(item.actionId)
    if (item.type === 'command') {
      // a disabled or unavailable command leaves its slot empty
      const command = commands.get(item.commandId)
      return command && isMenuCommand(command, deps.operations)
        ? createCommandActionItem(command)
        : undefined
    }
    if (item.type === 'transformation') {
      return createTransformationActionItem(item.transformationId)
    }
    if (item.type === 'styling') {
      return createStylingActionItem(item.stylingId)
    }
    if (item.type === 'chatPrompt') {
      return createChatPromptActionItem(item.promptId)
    }
    if (item.type === 'translation') {
      return createTranslationActionItem(item.language)
    }
    if (item.type === 'profileChat') {
      return createProfileChatActionItem(configProfileKey(item))
    }
    if (item.type === 'profile') {
      return createProfileActionItem(configProfileKey(item), item.action)
    }
    if (item.type === 'actionPage') {
      return createActionPageActionItem(item.pageIndex)
    }
    return undefined
  }

  const getShortcutActions = (
    targetPageIndex = pageIndex.value
  ): (ActionItem | undefined)[] => {
    const connected = deps.connectedVaultIds?.()
    const isAway = (item: MainActionConfig | null | undefined) =>
      connected !== undefined &&
      (item?.type === 'profile' || item?.type === 'profileChat') &&
      Boolean(item.vaultId) &&
      !connected.includes(item.vaultId!)
    const slots = resolveMainActions(undefined, targetPageIndex)
      .filter((item) => !isAway(item))
      .map(resolveActionItem)
    while (slots.length && !slots.at(-1)) slots.pop()
    return [
      ...slots,
      ...registeredActionsMenu.value.filter((action) => !action.id),
    ]
  }

  /**
   * Runs a built-in action such as `copyToClipboard` or `insertIntoWindow` on
   * `text`; false when there is no action by that id.
   */
  const runDefaultAction = async (id: string, text: string) => {
    const action = getDefaultActions().find((item) => item.id === id)
    if (!action) return false
    await action.action(text)
    return true
  }

  const getActionsMenu = (targetPageIndex = pageIndex.value) =>
    getShortcutActions(targetPageIndex).filter(
      (action): action is ActionItem => !!action
    )

  const registerActionsItems = registry.register
  const unregisterPlugin = registry.unregisterPlugin

  return {
    registeredActionsMenu,
    unregisterPlugin,
    getRegisteredActions,
    resolveMainActions,
    getDefaultActions,
    runDefaultAction,
    correct,
    getActionsMenu,
    getShortcutActions,
    resolveActionItem,
    registerActionsItems,
    pageIndex,
    pageCount,
    currentPage,
    takesText,
    textPageIndexes,
    setPage,
    stepPageWithin,
    openPage,
    repeatOpenPage,
    nextPage,
    prevPage,
  }
}
