import { describe, expect, it } from 'vitest'

import {
  isChatWebUrl,
  renderChatMarkdown,
  type ChatMarkdownLabels,
} from './chat-markdown'

const labels: ChatMarkdownLabels = {
  reasoning: 'Reasoning',
  footnotes: 'Footnotes',
  footnoteBack: 'Back to reference',
  loadImage: 'Load image',
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}
function render(markdown: string, scope = 'test') {
  const root = document.createElement('div')
  root.innerHTML = renderChatMarkdown(markdown, labels, scope)
  return root
}

describe('chat-markdown', () => {
  it('renders headings, nested lists, tasks, emphasis, quotes and horizontal rules', () => {
    const root = render(
      '# Title\n\n#### Detail\n\n**Bold** *italic* ~~removed~~ `code`\n\n3. Three\n   - Nested\n\n- [x] Done\n- [ ] Todo\n\n> Quote\n\n---'
    )
    expect(root.querySelector('h1')?.textContent).toBe('Title')
    expect(root.querySelector('h4')?.textContent).toBe('Detail')
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3')
    expect(root.querySelector('ol ul li')?.textContent).toBe('Nested')
    expect(root.querySelectorAll('input[disabled]')).toHaveLength(2)
    expect(root.querySelector('input[checked]')).not.toBeNull()
    for (const tag of ['strong', 'em', 'del', 'code', 'blockquote', 'hr'])
      expect(root.querySelector(tag)).not.toBeNull()
  })

  it('preserves table alignment and fenced code languages and whitespace', () => {
    const root = render(
      '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n\n```ts\nconst answer = 42\n  // comment\n```'
    )
    expect(
      Array.from(root.querySelectorAll('td')).map((cell) =>
        cell.getAttribute('align')
      )
    ).toEqual(['left', 'center', 'right'])
    expect(root.querySelector('pre code')?.className).toBe('language-ts')
    expect(root.querySelector('pre code')?.textContent).toBe(
      'const answer = 42\n  // comment\n'
    )
  })

  it('keeps safe web links and removes unsafe or local destinations', () => {
    const root = render(
      '[source](https://example.com)\n\nhttps://example.com\n\n[x](javascript:alert%281%29) [file](file:///etc/passwd) [local](/config) [credentials](https://user:pass@example.com)'
    )
    expect(root.querySelectorAll('a[href]')).toHaveLength(2)
    expect(root.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com'
    )
    expect(root.innerHTML).not.toContain('javascript:')
    expect(root.innerHTML).not.toContain('file:')
  })

  it('scopes heading anchors and footnotes to each message without breaking targets or accessibility', () => {
    const markdown =
      '## Section\n\n[Jump](#section) Text[^1]\n\n[^1]: Reference'
    const first = render(markdown, 'first')
    const second = render(markdown, 'second')
    for (const root of [first, second]) {
      for (const link of root.querySelectorAll('a[href^="#"]')) {
        const id = link.getAttribute('href')!.slice(1)
        expect(
          Array.from(root.querySelectorAll('[id]')).some(
            (node) => node.id === id
          )
        ).toBe(true)
      }
      const ref = root.querySelector('[data-footnote-ref]')!
      expect(root.querySelector('h2.sr-only')?.id).toBe(
        ref.getAttribute('aria-describedby')
      )
    }
    expect(first.querySelector('[data-footnote-ref]')?.id).not.toBe(
      second.querySelector('[data-footnote-ref]')?.id
    )
  })

  it.each(['$x^2$', '\\(x^2\\)', '$$\n\\frac{a}{b}\n$$', '\\[\\frac{a}{b}\\]'])(
    'renders LaTeX %s with accessible math',
    (markdown) => {
      const root = render(markdown)
      expect(root.querySelector('.katex')).not.toBeNull()
      expect(root.querySelector('math annotation')?.textContent).toMatch(
        /x\^2|\\frac\{a\}\{b\}/
      )
    }
  )

  it('renders single-line double dollar delimiters as display math', () => {
    expect(render('$$E=mc^2$$').querySelector('.katex-display')).not.toBeNull()
  })

  it('renders broken formulas as readable errors without failing the response', () => {
    const root = render('Before $\\frac{$ after')
    expect(root.querySelector('.katex-error')).not.toBeNull()
    expect(root.textContent).toContain('Before')
    expect(root.textContent).toContain('after')
  })

  it('does not turn math or think tags inside code into rendered features', () => {
    const root = render(
      '`\\(x\\)`\n\n```text\n\\[y\\]\n<think>example</think>\n```'
    )
    expect(root.querySelector('.katex')).toBeNull()
    expect(root.querySelector('details')).toBeNull()
    expect(root.querySelector('pre code')?.textContent).toContain(
      '<think>example</think>'
    )
  })

  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])(
    'renders %s alerts',
    (kind) => {
      const root = render(`> [!${kind}]\n> **Content**`)
      expect(
        root.querySelector(`.chat-alert-${kind.toLowerCase()}`)
      ).not.toBeNull()
      expect(root.querySelector('.chat-alert-title')?.textContent).toBe(
        labels[kind.toLowerCase() as keyof ChatMarkdownLabels]
      )
      expect(root.querySelector('strong')?.textContent).toBe('Content')
      expect(root.textContent).not.toContain('[!')
    }
  )

  it('preserves details and folds reasoning independently of the answer', () => {
    const root = render(
      '<think>Private **reasoning**</think>\n\nAnswer\n\n<details><summary>More</summary>Extra</details>'
    )
    const details = root.querySelector('details')!
    expect(details.hasAttribute('open')).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Reasoning')
    expect(details.querySelector('strong')?.textContent).toBe('reasoning')
    expect(details.textContent).not.toContain('Answer')
    expect(root.querySelectorAll('details')).toHaveLength(2)
  })

  it('preserves incomplete streaming blocks without throwing', () => {
    for (const markdown of [
      '**Pending',
      '```ts\nconst x =',
      '<think>Pending',
      '$\\frac{',
      '\\[x+',
      '| A | B |\n| ---',
    ]) {
      expect(() => render(markdown)).not.toThrow()
    }
  })

  it('replaces remote images with explicit proxy loading and blocks local and active image sources', () => {
    const root = render(
      '![Diagram](https://example.com/image.png)\n\n![Local](file:///etc/passwd)\n\n<img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="alert(1)">'
    )
    expect(root.querySelector('img')?.getAttribute('src')).toBeNull()
    expect(root.querySelector('img')?.alt).toBe('Diagram')
    expect(root.querySelector('button')?.dataset.imageUrl).toBe(
      'https://example.com/image.png'
    )
    expect(root.innerHTML).not.toContain('file:')
    expect(root.innerHTML).not.toContain('data:image/svg')
    expect(root.innerHTML).not.toContain('onerror')
  })

  it('sanitizes raw HTML, CSS and hostile math commands', () => {
    const root = render(
      '<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<details onclick="alert(1)"><summary style="background:url(https://evil.test)">Safe</summary>Text</details>\n\n$\\href{javascript:alert(1)}{click}$\n\n$\\includegraphics{https://evil.test/image.png}$'
    )
    expect(root.querySelector('script, iframe')).toBeNull()
    expect(root.querySelector('[onclick], [onerror]')).toBeNull()
    expect(root.querySelector('summary')?.hasAttribute('style')).toBe(false)
    expect(root.querySelector('a[href], img[src]')).toBeNull()
  })

  it('escapes translated labels rather than treating them as model HTML', () => {
    const html = renderChatMarkdown('<think>text</think>', {
      ...labels,
      reasoning: '<img src=x onerror=alert(1)>',
    })
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('summary')?.textContent).toBe(
      '<img src=x onerror=alert(1)>'
    )
    expect(html).not.toContain('<img')
  })
})

describe('isChatWebUrl', () => {
  it.each(['https://example.com', 'http://example.com/path?q=1'])(
    'accepts %s',
    (url) => expect(isChatWebUrl(url)).toBe(true)
  )
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    '/config',
    '//example.com',
    'https://user:secret@example.com',
  ])('rejects %s', (url) => expect(isChatWebUrl(url)).toBe(false))
})
