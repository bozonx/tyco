import type { EditorView } from '@codemirror/view'
import { WidgetType } from '@codemirror/view'
import DOMPurify from 'dompurify'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify)

/** Puts the cursor at `from` instead of selecting inside a rendered block */
function moveCursorTo(view: EditorView, from: number, event: Event) {
  event.preventDefault()
  view.dispatch({ selection: { anchor: from }, scrollIntoView: true })
  view.focus()
}

/** Render complex blocks without creating a second editable document. */
export class PreviewWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly kind: 'table' | 'image' | 'rule'
  ) {
    super()
  }

  override eq(other: PreviewWidget): boolean {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.kind === other.kind
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.createElement('div')
    dom.className = `cm-preview-widget cm-preview-${this.kind}`
    dom.innerHTML = DOMPurify.sanitize(
      String(
        renderer.processSync(
          this.kind === 'table'
            ? this.source.replace(/^(?:[ \t]*>[ \t]?)+/gm, '')
            : this.source
        )
      ),
      { FORBID_ATTR: ['src', 'srcset'] }
    )
    // Remote images cannot be fetched by the webview. Keep their alt text editable.
    for (const image of dom.querySelectorAll('img')) {
      const src =
        /^!\[[^\]]*\]\((data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+)\)$/.exec(
          this.source
        )?.[1] ?? ''
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) {
        const label = view.dom.ownerDocument.createElement('span')
        label.className = 'cm-preview-image-label'
        label.textContent = image.alt || this.source
        image.replaceWith(label)
      } else {
        image.src = src
      }
    }
    dom.addEventListener('click', (event) => event.preventDefault())
    dom.addEventListener('mousedown', (event) =>
      moveCursorTo(view, this.from, event)
    )
    return dom
  }

  override ignoreEvent(): boolean {
    return true
  }
}

const COPY_ICON_SVG =
  '<svg class="cm-preview-copy-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 21H8V7h11m0-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m-3-4H4a2 2 0 0 0-2 2v14h2V3h12z"/></svg>'

const CHECK_ICON_SVG =
  '<svg class="cm-preview-check-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M21 7L9 19l-5.5-5.5l1.41-1.41L9 16.17L19.59 5.59z"/></svg>'

export class CodeBlockHeaderWidget extends WidgetType {
  constructor(
    readonly info: string,
    readonly code: string,
    readonly from: number
  ) {
    super()
  }

  override eq(other: CodeBlockHeaderWidget): boolean {
    return (
      this.info === other.info &&
      this.code === other.code &&
      this.from === other.from
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.createElement('div')
    dom.className = 'cm-preview-code-header'

    const infoSpan = view.dom.ownerDocument.createElement('span')
    infoSpan.className = 'cm-preview-code-info'
    infoSpan.textContent = this.info
    dom.appendChild(infoSpan)

    const copyBtn = view.dom.ownerDocument.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'cm-preview-code-copy'
    copyBtn.title = view.state.phrase('Copy code')
    copyBtn.setAttribute('aria-label', view.state.phrase('Copy code'))
    copyBtn.innerHTML = COPY_ICON_SVG
    const status = view.dom.ownerDocument.createElement('span')
    status.className = 'cm-preview-copy-status'
    status.setAttribute('role', 'status')
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined

    copyBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })

    copyBtn.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      clearTimeout(feedbackTimer)
      copyBtn.disabled = true
      copyBtn.innerHTML = COPY_ICON_SVG
      copyBtn.classList.remove('copied')
      status.textContent = ''
      try {
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard is not available')
        await navigator.clipboard.writeText(this.code)
        if (!copyBtn.isConnected) return
        copyBtn.innerHTML = CHECK_ICON_SVG
        copyBtn.classList.add('copied')
        status.textContent = view.state.phrase('Copied')
        feedbackTimer = setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON_SVG
          copyBtn.classList.remove('copied')
          status.textContent = ''
        }, 1500)
      } catch {
        status.textContent = view.state.phrase('Clipboard is not available')
      } finally {
        copyBtn.disabled = false
      }
    })

    dom.appendChild(copyBtn)
    dom.appendChild(status)

    dom.addEventListener('mousedown', (event) => {
      if (event.target === copyBtn || copyBtn.contains(event.target as Node)) {
        return
      }
      moveCursorTo(view, this.from, event)
    })

    return dom
  }

  override ignoreEvent(): boolean {
    return true
  }
}

export class MarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
    readonly checked?: boolean
  ) {
    super()
  }

  override eq(other: MarkerWidget): boolean {
    return (
      this.text === other.text &&
      this.from === other.from &&
      this.checked === other.checked
    )
  }

  toDOM(view: EditorView): HTMLElement {
    if (this.checked === undefined) {
      const marker = view.dom.ownerDocument.createElement('span')
      marker.className = 'cm-preview-list-marker'
      marker.textContent = this.text
      return marker
    }
    const checkbox = view.dom.ownerDocument.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = this.checked
    checkbox.className = 'cm-preview-checkbox'
    checkbox.setAttribute('aria-label', view.state.doc.lineAt(this.from).text)
    checkbox.addEventListener('mousedown', (event) => event.preventDefault())
    checkbox.addEventListener('change', () => {
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: checkbox.checked ? 'x' : ' ',
        },
        userEvent: 'input.task',
      })
    })
    return checkbox
  }

  override ignoreEvent(): boolean {
    return true
  }
}
