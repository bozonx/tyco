import { afterEach, describe, expect, it } from 'vitest'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useActionMenuStore } from './action-menu'
import { MenuModals, useMenuModalsStore } from './menu-modals'

describe('voice command action context', () => {
  let desktop: TestDesktop | undefined
  afterEach(() => desktop?.dispose())

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
