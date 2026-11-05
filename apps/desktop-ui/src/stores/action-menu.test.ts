import { afterEach, describe, expect, it } from 'vitest'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useActionMenuStore } from './action-menu'
import { MenuModals, useMenuModalsStore } from './menu-modals'

describe('voice command action context', () => {
  let desktop: TestDesktop | undefined
  afterEach(() => desktop?.dispose())

  it.each(['', 'Selected passage'])(
    'opens context-free voice commands without selection tracking (text: %j)',
    async (text) => {
      desktop = await loadFakeDesktop({
        mode: 'selectionActions',
        activation: { activationId: 42, selectedText: text },
      })
      desktop.setUserConfig({
        actionPages: [
          {
            inputMode: 'selection',
            slots: {
              q: { type: 'standard', actionId: 'voiceCommandsWithoutContext' },
            },
          },
        ],
      })
      const actions = useActionMenuStore()
      const action = actions.getShortcutActions()[0]
      expect(action?.id).toBe('voiceCommandsWithoutContext')
      await action?.action(text)
      expect(useMenuModalsStore().currentStep?.params).toEqual({ text: '' })

      desktop.setState({ selectedText: 'Late selected text' })
      expect(useMenuModalsStore().currentStep?.params).toEqual({ text: '' })
    }
  )

  it('opens voice commands with the supplied selection', async () => {
    desktop = await loadFakeDesktop({ mode: 'selectionActions' })
    await useActionMenuStore().runDefaultAction(
      'voiceCommands',
      'Selected passage'
    )
    expect(useMenuModalsStore().currentStep?.params).toEqual({
      text: 'Selected passage',
    })
  })

  it.each(['selection', 'none'] as const)(
    'follows late capture only on a %s page',
    async (inputMode) => {
      desktop = await loadFakeDesktop({
        mode: 'selectionActions',
        activation: { activationId: 42, actionPageIndex: 1 },
      })
      desktop.setUserConfig({
        actionPages: [
          { inputMode: 'selection', slots: {} },
          { inputMode, slots: {} },
        ],
      })
      const actions = useActionMenuStore()
      actions.setPage(1)
      await actions.runDefaultAction('voiceCommands', '')
      const step = useMenuModalsStore().currentStep
      expect(step?.modal).toBe(MenuModals.VOICE_COMMANDS)
      expect(step?.params).toMatchObject({ text: '' })
      if (inputMode === 'selection')
        expect(step?.params).toHaveProperty('selectionActivationId', 42)
      else expect(step?.params).not.toHaveProperty('selectionActivationId')
    }
  )
})

describe('window actions', () => {
  let desktop: TestDesktop | undefined
  afterEach(() => desktop?.dispose())

  it.each([
    ['openHistory', 'history'],
    ['voiceInput', 'voice'],
  ] as const)(
    'activates %s without passing the selected text',
    async (action, mode) => {
      desktop = await loadFakeDesktop({ mode: 'selectionActions' })
      desktop.backend.handle('activate_mode', () => undefined)
      await useActionMenuStore().runDefaultAction(action, 'selected text')
      expect(desktop.backend.callsOf('activate_mode')).toEqual([{ mode }])
    }
  )
})
