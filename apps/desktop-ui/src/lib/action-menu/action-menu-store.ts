import { shallowRef } from 'vue'

import {
  APP_CONFIG,
  type CommandConfig,
  type MainActionConfig,
} from '@tyco/shared'

import {
  commandIcon,
  commandLabel,
  isMenuCommand,
} from '../commands/command-config'
import {
  type CommandRunnerDependencies,
  createCommandRunner,
} from '../commands/command-runner'
import { assignPluginActions } from './main-actions'

export interface ActionItem {
  id?: string
  preferredKey?: string
  name?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
  /** Why the action is disabled, shown on hover */
  hint?: string
  useFullEditorText?: boolean
  preserveWhitespace?: boolean
  action: (text: string) => Promise<void>
}

export interface ActionMenuDependencies extends CommandRunnerDependencies {
  typeIntoWindowAndClose: (text: string) => void
  putIntoClipboardAndClose: (text: string) => Promise<void>
  /** Records a text that leaves the app; runs before the window closes. */
  saveOutput: (text: string) => Promise<void>
  openAiTaskModal: (text: string) => void
  openTranslateModal: (text: string) => void
  /** `extra` goes to the params of the correction step, see `InsertMenu` */
  startCorrection: (
    text: string,
    extra?: Record<string, unknown>
  ) => Promise<void>
  startChatWithAttachment: (text: string) => void
  minCorrectionLength?: () => number
  mainActionRegistrations?: () => readonly string[] | undefined
  mainActions?: () => readonly (MainActionConfig | null)[] | undefined
  /** The command library the menu items of the `command` type refer to */
  commands?: () => readonly CommandConfig[] | undefined
}

export function createActionMenuStoreModel(deps: ActionMenuDependencies) {
  const registeredActionsMenu = shallowRef<ActionItem[]>([])
  const commandRunner = createCommandRunner(deps)

  /** The menu item of a command; the text leaves the app with it */
  const createCommandActionItem = (command: CommandConfig): ActionItem => ({
    id: `command:${command.id}`,
    name: commandLabel(command),
    icon: commandIcon(command, deps.tools),
    action: async (text: string) => {
      await deps.saveOutput(text)
      await commandRunner.run(command, text, { source: 'menu' })
    },
  })

  /** Corrects `text` on a step of its own, unless it is empty or too short. */
  const correct = async (
    text: string,
    extra?: Record<string, unknown>
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

  const getDefaultActions = (): ActionItem[] => [
    {
      id: 'insertIntoWindow',
      labelKey: 'action.insertIntoWindow',
      icon: 'mdi:application-export',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        await deps.saveOutput(text)
        deps.typeIntoWindowAndClose(text)
      },
    },
    {
      id: 'copyToClipboard',
      labelKey: 'action.copyToClipboard',
      icon: 'mdi:clipboard-arrow-right-outline',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        await deps.saveOutput(text)
        await deps.putIntoClipboardAndClose(text)
      },
    },
    {
      id: 'aiTask',
      labelKey: 'action.aiTask',
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
      id: 'translation',
      labelKey: 'action.translation',
      icon: 'mdi:translate',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.openTranslateModal(text)
      },
    },
    {
      id: 'askInChat',
      labelKey: 'action.askInChat',
      icon: 'mdi:chat-outline',
      action: async (text: string) => {
        if (!text?.trim()) {
          deps.showToast('toast.textNotSelected', 'error')
          return
        }
        deps.startChatWithAttachment(text)
      },
    },
  ]

  const getRegisteredActions = () => registeredActionsMenu.value

  const resolveMainActions = (
    config: unknown = deps.mainActions?.(),
    registrations = deps.mainActionRegistrations?.()
  ) => assignPluginActions(config, registeredActionsMenu.value, registrations)

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
      if (item.type === 'standard') return defaults.get(item.actionId)
      if (item.type === 'plugin') return plugins.get(item.actionId)
      if (item.type === 'command') {
        // a disabled command, or one that takes no text, leaves its slot empty
        const command = commands.get(item.commandId)
        return command && isMenuCommand(command, deps.tools)
          ? createCommandActionItem(command)
          : undefined
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

  const registerActionsItems = (actions: ActionItem[]) => {
    const next = [...registeredActionsMenu.value]
    for (const action of actions) {
      const index = action.id
        ? next.findIndex((item) => item.id === action.id)
        : -1
      if (index >= 0) next[index] = action
      else next.push(action)
    }
    registeredActionsMenu.value = next
  }

  const clearRegisteredActions = () => {
    registeredActionsMenu.value = []
  }

  return {
    getRegisteredActions,
    resolveMainActions,
    getDefaultActions,
    correct,
    getActionsMenu,
    getShortcutActions,
    registerActionsItems,
    clearRegisteredActions,
  }
}
