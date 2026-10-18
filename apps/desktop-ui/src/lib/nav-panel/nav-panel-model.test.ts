import { describe, expect, it, vi } from 'vitest'

import { createNavPanelModel, DEFAULT_NAV_PANEL_STATE } from './nav-panel-model'

describe('createNavPanelModel', () => {
  it('applies overrides and resets back to defaults', () => {
    const onEscape = vi.fn()
    const model = createNavPanelModel({
      hasOpenModal: () => false,
      backModal: vi.fn(),
    })

    model.resetNavPanelState({
      panelVisible: false,
      escapeButtonLabelKey: 'menu.actions',
      onEscape,
    })
    expect(model.navPanelState.value).toEqual({
      panelVisible: false,
      escapeButtonLabelKey: 'menu.actions',
      onEscape,
    })

    model.resetNavPanelState()
    expect(model.navPanelState.value).toEqual(DEFAULT_NAV_PANEL_STATE)
  })

  it('steps back in open modals on Escape or invokes onEscape when none is open', () => {
    let modalOpen = true
    const backModal = vi.fn()
    const onEscape = vi.fn()
    const model = createNavPanelModel({
      hasOpenModal: () => modalOpen,
      backModal,
    })
    model.resetNavPanelState({ onEscape })

    model.handleKeyUp({ code: 'Escape', defaultPrevented: false })
    expect(backModal).toHaveBeenCalledOnce()
    expect(onEscape).not.toHaveBeenCalled()

    modalOpen = false
    model.handleKeyUp({ code: 'Escape', defaultPrevented: false })
    expect(onEscape).toHaveBeenCalledOnce()

    model.handleKeyUp({ code: 'Escape', defaultPrevented: true })
    expect(onEscape).toHaveBeenCalledOnce()
  })
})
