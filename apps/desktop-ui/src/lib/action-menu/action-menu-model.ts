import type { CorrectionStepExtra } from '../correction/correction-step'
import type { ActionItem } from '../../types/plugins'
import { createContributionRegistry } from '../plugins/contribution-registry'

import {
  APP_CONFIG,
  type CommandConfig,
  type CoreToolId,
  type MainActionConfig,
  type ShortcutSlots,
} from '@tyco/shared'

import {
  commandIcon,
  commandLabel,
  commandTakesText,
  isMenuCommand,
} from '../commands/command-runtime'
import { createCommandRunner } from '../commands/command-runner'
import { i18n, translate } from '../i18n'
import { messages } from '../i18n/messages'
import { translationLanguageLabel } from '../translation/translation-languages'
import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
} from '../invocation/invocation-runner'
import { getLanguageLabelKey } from '../locale/language'
import { normalizeMainActions } from './main-actions'

export type { ActionItem } from '../../types/plugins'
export interface ActionMenuDependencies extends InvocationRunnerDependencies {
  /** Records a text that leaves the app; runs before the window closes. */
  saveOutput: (text: string) => Promise<void>
  /** With `taskId` the dialog runs that AI task at once */
  openAiTaskModal: (text: string, taskId?: string) => void
  /** With `language` the dialog translates into it at once */
  openTranslateModal: (text: string, language?: string) => void
  /** `extra` goes to the params of the correction step, see `InsertMenu` */
  startCorrection: (text: string, extra?: CorrectionStepExtra) => Promise<void>
  minCorrectionLength?: () => number
  openLauncherPage?: (pageId: string, text: string) => Promise<void>
  launcherPages?: () => readonly { id: string }[]
  isMainActionVisible?: (action: MainActionConfig) => boolean
  mainActions?: () => ShortcutSlots<MainActionConfig> | undefined
  /** The command library the menu items of the `command` type refer to */
  commands?: () => readonly CommandConfig[] | undefined
  /** The AI tasks the menu items of the `aiTask` type refer to by id */
  aiTasks?: () => readonly { id: string; name: string }[] | undefined
}

export function createActionMenuModel(deps: ActionMenuDependencies) {
  const registry = createContributionRegistry<ActionItem>()
  const registeredActionsMenu = registry.items
  const commandRunner = createCommandRunner(deps)
  const invocationRunner = createInvocationRunner(deps)

  /**
   * The menu item of a built-in action that runs a core tool as it is: it needs
   * no command of the library. `leavesApp` records the text before it goes
   */
  const createBuiltinActionItem = (
    item: Required<Pick<ActionItem, 'id' | 'labelKey' | 'icon'>>,
    toolId: CoreToolId,
    leavesApp: boolean
  ): ActionItem => ({
    ...item,
    action: async (text: string) => {
      if (!text?.trim()) {
        deps.showToast('toast.textNotSelected', 'error')
        return
      }
      if (leavesApp) await deps.saveOutput(text)
      await invocationRunner.run(
        { toolId, toolConfig: {}, label: translate(item.labelKey) },
        text,
        { source: 'menu' }
      )
    },
  })

  /** The menu item of a command; the text, if it takes one, leaves the app */
  const createCommandActionItem = (command: CommandConfig): ActionItem => ({
    id: `command:${command.id}`,
    name: commandLabel(command),
    icon: commandIcon(command, deps.tools),
    action: async (text: string) => {
      if (commandTakesText(command, deps.tools)) await deps.saveOutput(text)
      await commandRunner.run(command, text, { source: 'menu' })
    },
  })

  /** Runs `action` on the text, unless there is none */
  const withText =
    (action: (text: string) => void) =>
    async (text: string): Promise<void> => {
      if (!text?.trim()) {
        deps.showToast('toast.textNotSelected', 'error')
        return
      }
      action(text)
    }

  /** The menu item of an AI task, or none when the task is gone */
  const createAiTaskActionItem = (taskId: string): ActionItem | undefined => {
    const task = deps.aiTasks?.()?.find((item) => item.id === taskId)
    if (!task?.name) return undefined
    return {
      id: `aiTask:${taskId}`,
      name: task.name,
      icon: 'mdi:robot-outline',
      action: withText((text) => deps.openAiTaskModal(text, taskId)),
    }
  }

  const createTranslationActionItem = (language: string): ActionItem => ({
    id: `translation:${language}`,
    ...(Object.hasOwn(messages['en-US'].language, language)
      ? { labelKey: getLanguageLabelKey(language) }
      : { name: translationLanguageLabel(language, i18n.global.locale.value) }),
    icon: 'mdi:translate',
    action: withText((text) => deps.openTranslateModal(text, language)),
  })

  /** Corrects `text` on a step of its own, unless it is empty or too short. */
  const correct = async (
    text: string,
    extra?: CorrectionStepExtra
  ): Promise<void> => {
    if (!text?.trim()) {
      deps.showToast('toast.textNotSelected', 'error')
      return
    }
    const minLength =
      deps.minCorrectionLength?.() ?? APP_CONFIG.minCorrectionLength
    if (text.length < minLength) {
      deps.showToast('toast.textTooShortForCorrection', 'warn')
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
          true
        ),
        {
          id: 'aiTaskMenu',
          labelKey: 'action.aiTaskMenu',
          icon: 'mdi:robot-outline',
          action: async (text: string) => {
            if (!text?.trim()) {
              deps.showToast('toast.textNotSelected', 'error')
              return
            }
            deps.openAiTaskModal(text)
          },
        },
        {
          id: 'correction',
          labelKey: 'action.correction',
          icon: 'mdi:auto-fix',
          action: (text: string) => correct(text),
        },
        {
          id: 'translationMenu',
          labelKey: 'action.translationMenu',
          icon: 'mdi:translate',
          action: async (text: string) => {
            if (!text?.trim()) {
              deps.showToast('toast.textNotSelected', 'error')
              return
            }
            deps.openTranslateModal(text)
          },
        },
        createBuiltinActionItem(
          {
            id: 'askInChat',
            labelKey: 'action.askInChat',
            icon: 'mdi:chat-outline',
          },
          'core.askInChat',
          false
        ),
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

  const resolveMainActions = (config: unknown = deps.mainActions?.()) =>
    normalizeMainActions(config).map((action) =>
      action && deps.isMainActionVisible && !deps.isMainActionVisible(action)
        ? null
        : action
    )

  const getShortcutActions = (): (ActionItem | undefined)[] => {
    const defaults = new Map(
      getDefaultActions().map((action) => [action.id, action])
    )
    const plugins = new Map(
      registeredActionsMenu.value.map((action) => [action.id, action])
    )
    const commands = new Map(
      (deps.commands?.() ?? []).map((command) => [command.id, command])
    )
    const slots = resolveMainActions().map((item) => {
      if (!item) return undefined
      if (item.type === 'launcherPage')
        return {
          name: translate('settings.launcherPage', {
            page:
              (deps.launcherPages?.() ?? []).findIndex(
                (page) => page.id === item.pageId
              ) + 1,
          }),
          icon: 'mdi:view-grid-outline',
          action: async (text: string) => {
            await deps.openLauncherPage?.(item.pageId, text)
          },
        }
      if (item.type === 'standard') return defaults.get(item.actionId)
      if (item.type === 'plugin') return plugins.get(item.actionId)
      if (item.type === 'command') {
        // a disabled or unavailable command leaves its slot empty
        const command = commands.get(item.commandId)
        return command && isMenuCommand(command, deps.tools)
          ? createCommandActionItem(command)
          : undefined
      }
      if (item.type === 'aiTask') return createAiTaskActionItem(item.taskId)
      if (item.type === 'translation') {
        return createTranslationActionItem(item.language)
      }
      return undefined
    })
    while (slots.length && !slots.at(-1)) slots.pop()
    return [
      ...slots,
      ...registeredActionsMenu.value.filter((action) => !action.id),
    ]
  }

  const getActionsMenu = () =>
    getShortcutActions().filter((action): action is ActionItem => !!action)

  const registerActionsItems = registry.register
  const unregisterPlugin = registry.unregisterPlugin

  return {
    registeredActionsMenu,
    unregisterPlugin,
    getRegisteredActions,
    resolveMainActions,
    getDefaultActions,
    correct,
    getActionsMenu,
    getShortcutActions,
    registerActionsItems,
  }
}
