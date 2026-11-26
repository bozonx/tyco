import { describe, expect, it, vi } from 'vitest'

import {
  createContentSearchSession,
  findContentMatches,
} from './content-search'

describe('content-search', () => {
  it('finds matches in text nodes while ignoring buttons and inputs', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="message">
        <p>Hello world, hello everyone!</p>
        <button>hello in button</button>
        <div class="content-search-bar">hello in search bar</div>
        <span>Another Hello</span>
      </div>
    `
    document.body.appendChild(container)

    const matches = findContentMatches(container, 'hello')
    expect(matches).toHaveLength(3) // 2 in the paragraph + 1 in the span
    expect(matches[0].element.tagName.toLowerCase()).toBe('p')
    expect(matches[1].element.tagName.toLowerCase()).toBe('p')
    expect(matches[2].element.tagName.toLowerCase()).toBe('span')

    document.body.removeChild(container)
  })

  it('respects matchCase option', () => {
    const container = document.createElement('div')
    container.innerHTML = `<p>Test test TEST</p>`
    document.body.appendChild(container)

    const insensitive = findContentMatches(container, 'test', {
      matchCase: false,
    })
    expect(insensitive).toHaveLength(3)

    const sensitive = findContentMatches(container, 'test', { matchCase: true })
    expect(sensitive).toHaveLength(1)

    document.body.removeChild(container)
  })

  it('returns empty array on empty or whitespace query', () => {
    const container = document.createElement('div')
    container.innerHTML = `<p>Some text</p>`
    expect(findContentMatches(container, '')).toEqual([])
    expect(findContentMatches(container, '   ')).toEqual([])
  })

  it('navigates next and previous circularly with scrollIntoView', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <p id="first">apple one</p>
      <p id="second">apple two</p>
    `
    document.body.appendChild(container)

    const firstP = container.querySelector('#first') as HTMLElement
    const secondP = container.querySelector('#second') as HTMLElement
    firstP.scrollIntoView = vi.fn()
    secondP.scrollIntoView = vi.fn()

    const session = createContentSearchSession(container, 'apple')
    expect(session.count).toBe(2)
    expect(session.activeIndex).toBe(0)
    expect(firstP.scrollIntoView).toHaveBeenCalled()

    session.next()
    expect(session.activeIndex).toBe(1)
    expect(secondP.scrollIntoView).toHaveBeenCalled()

    session.next()
    expect(session.activeIndex).toBe(0)

    session.previous()
    expect(session.activeIndex).toBe(1)

    session.destroy()
    document.body.removeChild(container)
  })
})
