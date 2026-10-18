import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusAfterTrigger, focusableElements } from './focus-navigation'

describe('focus-navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function mockVisible(element: HTMLElement) {
    vi.spyOn(element, 'getClientRects').mockReturnValue([
      {
        width: 10,
        height: 10,
        top: 0,
        left: 0,
        bottom: 10,
        right: 10,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
    ] as unknown as DOMRectList)
    return element
  }

  describe('focusableElements', () => {
    it('returns only visible, enabled, non-inert elements with non-negative tabIndex', () => {
      const container = document.createElement('div')
      container.innerHTML = `
        <button id="btn1">Button 1</button>
        <button id="btnDisabled" disabled>Disabled</button>
        <a id="link1" href="https://example.com">Link</a>
        <a id="linkNoHref">Link without href</a>
        <input id="input1" type="text" />
        <select id="select1"><option>Opt</option></select>
        <textarea id="textarea1"></textarea>
        <div id="tabDiv" tabindex="0">Custom</div>
        <div id="negativeTabDiv" tabindex="-1">Excluded</div>
        <div inert id="inertContainer">
          <button id="btnInert">Inert button</button>
        </div>
        <button id="btnInvisible">Invisible</button>
      `
      document.body.appendChild(container)

      const btn1 = mockVisible(container.querySelector('#btn1')!)
      const link1 = mockVisible(container.querySelector('#link1')!)
      const input1 = mockVisible(container.querySelector('#input1')!)
      const select1 = mockVisible(container.querySelector('#select1')!)
      const textarea1 = mockVisible(container.querySelector('#textarea1')!)
      const tabDiv = mockVisible(container.querySelector('#tabDiv')!)

      // mockVisible for inert, negative, disabled just to ensure filter catches them
      mockVisible(container.querySelector('#btnDisabled')!)
      mockVisible(container.querySelector('#negativeTabDiv')!)
      mockVisible(container.querySelector('#btnInert')!)

      const elements = focusableElements(container)
      expect(elements).toEqual([
        btn1,
        link1,
        input1,
        select1,
        textarea1,
        tabDiv,
      ])
    })
  })

  describe('focusAfterTrigger', () => {
    it('focuses the next element after trigger, skipping elements inside panel', () => {
      const container = document.createElement('div')
      container.innerHTML = `
        <button id="first">First</button>
        <button id="trigger">Trigger</button>
        <div id="panel">
          <button id="insidePanel">Inside</button>
        </div>
        <button id="next">Next</button>
      `
      document.body.appendChild(container)

      const first = mockVisible(container.querySelector('#first')!)
      const trigger = mockVisible(container.querySelector('#trigger')!)
      mockVisible(container.querySelector('#insidePanel')!)
      const next = mockVisible(container.querySelector('#next')!)
      const panel = container.querySelector<HTMLElement>('#panel')!

      vi.spyOn(next, 'focus')
      vi.spyOn(first, 'focus')

      focusAfterTrigger(trigger, panel)

      expect(next.focus).toHaveBeenCalled()
      expect(first.focus).not.toHaveBeenCalled()
    })

    it('wraps around to the first element when trigger is the last candidate', () => {
      const container = document.createElement('div')
      container.innerHTML = `
        <button id="first">First</button>
        <button id="trigger">Trigger</button>
      `
      document.body.appendChild(container)

      const first = mockVisible(container.querySelector('#first')!)
      const trigger = mockVisible(container.querySelector('#trigger')!)

      vi.spyOn(first, 'focus')

      focusAfterTrigger(trigger, null)

      expect(first.focus).toHaveBeenCalled()
    })
  })
})
