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
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true })
      view.focus()
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
