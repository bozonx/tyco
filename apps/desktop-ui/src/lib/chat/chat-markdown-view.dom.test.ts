import { describe, expect, it, vi } from 'vitest'

import { createChatMarkdownView } from './chat-markdown-view'

function setup(markup: string) {
  const root = document.createElement('div')
  root.innerHTML = markup
  document.body.append(root)
  const deps = {
    highlight: vi.fn(
      async (source: string) => `<span class="hljs-keyword">${source}</span>`
    ),
    renderDiagram: vi.fn(
      async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })
    ),
    loadImage: vi.fn(async () => new Blob(['image'], { type: 'image/png' })),
    createObjectUrl: vi.fn(() => 'blob:preview'),
    revokeObjectUrl: vi.fn(),
    openLink: vi.fn(async () => undefined),
    copyCode: vi.fn(),
    labels: () => ({
      copyCode: 'Copy code',
      diagram: 'Diagram',
      diagramSource: 'Source',
      diagramError: 'Diagram error',
      imageError: 'Image error',
      loadingImage: 'Loading',
    }),
  }
  const view = createChatMarkdownView(deps)
  const click = async (target: Element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    target.addEventListener('click', (input) => input.preventDefault(), {
      once: true,
    })
    target.dispatchEvent(event)
    Object.defineProperty(event, 'target', { value: target })
    await view.handleClick(event)
    return event
  }
  return { root, deps, view, click }
}

const code = '<pre><code class="language-ts">const x = 1\n</code></pre>'
const diagram =
  '<pre><code class="language-mermaid">graph TD; A--&gt;B\n</code></pre>'
const image =
  '<span class="chat-image"><img alt="Example"><button data-image-url="https://example.com/image.png">Load</button></span>'

describe('chat-markdown-view', () => {
  it('highlights code and copies its original text', async () => {
    const { root, deps, view, click } = setup(code)
    await view.enhance(root, false)
    expect(root.querySelector('.hljs-keyword')).not.toBeNull()
    await click(root.querySelector('button')!)
    expect(deps.copyCode).toHaveBeenCalledWith('const x = 1\n')
    view.dispose()
  })

  it('retains code if highlighting fails', async () => {
    const { root, deps, view } = setup(code)
    deps.highlight.mockRejectedValue(new Error('Unavailable'))
    await view.enhance(root, false)
    expect(root.querySelector('code')?.textContent).toBe('const x = 1\n')
    view.dispose()
  })

  it('renders diagrams after streaming ends and keeps copyable source', async () => {
    const { root, deps, view, click } = setup(diagram)
    await view.enhance(root, true)
    expect(deps.renderDiagram).not.toHaveBeenCalled()
    root.innerHTML = diagram
    await view.enhance(root, false)
    expect(root.querySelector('figure img')?.getAttribute('src')).toBe(
      'blob:preview'
    )
    expect(root.querySelector('details')?.hasAttribute('open')).toBe(false)
    await click(root.querySelector('button')!)
    expect(deps.copyCode).toHaveBeenCalledWith('graph TD; A-->B\n')
    root.innerHTML = diagram
    await view.enhance(root, false)
    expect(deps.renderDiagram).toHaveBeenCalledTimes(1)
    expect(deps.revokeObjectUrl).toHaveBeenCalledWith('blob:preview')
    view.dispose()
    expect(deps.revokeObjectUrl).toHaveBeenCalledTimes(2)
  })

  it('shows diagram errors with the original source', async () => {
    const { root, deps, view } = setup(diagram)
    deps.renderDiagram.mockRejectedValue(new Error('Invalid diagram'))
    await view.enhance(root, false)
    expect(root.querySelector('.chat-render-error')?.textContent).toBe(
      'Diagram error'
    )
    expect(root.querySelector('code')?.textContent).toBe('graph TD; A-->B\n')
    view.dispose()
  })

  it('discards stale diagram results after content changes', async () => {
    const { root, deps, view } = setup(diagram)
    let resolve!: (blob: Blob) => void
    deps.renderDiagram.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = view.enhance(root, false)
    view.reset()
    root.innerHTML = 'New answer'
    resolve(new Blob(['svg']))
    await pending
    expect(root.textContent).toBe('New answer')
    expect(deps.createObjectUrl).not.toHaveBeenCalled()
    view.dispose()
  })

  it('opens external links through the injected opener and scrolls local anchors within this message', async () => {
    const { root, deps, view, click } = setup(
      '<a href="https://example.com">Web</a><a href="#chat-test-fn-1">Footnote</a><p id="chat-test-fn-1">Note</p>'
    )
    const scroll = vi.fn()
    root.querySelector('p')!.scrollIntoView = scroll
    await view.enhance(root, false)
    expect((await click(root.querySelector('a')!)).defaultPrevented).toBe(true)
    expect(deps.openLink).toHaveBeenCalledWith('https://example.com')
    await click(root.querySelectorAll('a')[1])
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(deps.openLink).toHaveBeenCalledTimes(1)
    view.dispose()
  })

  it('decodes heading anchors and opens containing details before focusing them', async () => {
    const { root, view, click } = setup(
      '<a href="#chat-test-%53ection">Jump</a><details><summary>More</summary><p id="chat-test-Section">Target</p></details>'
    )
    const target = root.querySelector('p')!
    target.scrollIntoView = vi.fn()
    await view.enhance(root, false)
    await click(root.querySelector('a')!)
    expect(root.querySelector('details')?.open).toBe(true)
    expect(document.activeElement).toBe(target)
    view.dispose()
  })

  it('never forwards unsafe destinations to the system opener', async () => {
    const { root, deps, view, click } = setup(
      '<a href="file:///etc/passwd">Local</a>'
    )
    await view.enhance(root, false)
    expect((await click(root.querySelector('a')!)).defaultPrevented).toBe(true)
    expect(deps.openLink).not.toHaveBeenCalled()
    view.dispose()
  })

  it('loads remote images only on click and reuses them after a rerender', async () => {
    const { root, deps, view, click } = setup(image)
    await view.enhance(root, false)
    expect(deps.loadImage).not.toHaveBeenCalled()
    await click(root.querySelector('button')!)
    expect(deps.loadImage).toHaveBeenCalledWith(
      'https://example.com/image.png',
      expect.any(AbortSignal)
    )
    expect(root.querySelector('img')?.src).toBe('blob:preview')
    expect(root.querySelector('button')?.hidden).toBe(true)
    root.innerHTML = image
    await view.enhance(root, false)
    expect(deps.loadImage).toHaveBeenCalledTimes(1)
    expect(root.querySelector('img')?.src).toBe('blob:preview')
    view.dispose()
  })

  it('allows image retry after network and decoding errors', async () => {
    const { root, deps, view, click } = setup(image)
    deps.loadImage.mockRejectedValueOnce(new Error('Offline'))
    await view.enhance(root, false)
    const button = root.querySelector('button')!
    await click(button)
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Image error')
    await click(button)
    root.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(button.disabled).toBe(false)
    expect(button.hidden).toBe(false)
    expect(button.textContent).toBe('Image error')
    view.dispose()
  })

  it('aborts pending image loads on unmount and ignores late results', async () => {
    const { root, deps, view, click } = setup(image)
    let resolve!: (blob: Blob) => void
    let signal!: AbortSignal
    deps.loadImage.mockImplementation(
      async (_url?: string, input?: AbortSignal) => {
        signal = input!
        return await new Promise((done) => {
          resolve = done
        })
      }
    )
    await view.enhance(root, false)
    const pending = click(root.querySelector('button')!)
    view.dispose()
    expect(signal.aborted).toBe(true)
    resolve(new Blob(['image']))
    await pending
    expect(deps.createObjectUrl).not.toHaveBeenCalled()
  })
})
