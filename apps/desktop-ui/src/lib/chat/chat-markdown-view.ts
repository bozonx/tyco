import { isChatWebUrl } from './chat-markdown'

interface ViewLabels {
  copyCode: string
  diagram: string
  diagramSource: string
  diagramError: string
  imageError: string
  loadingImage: string
}

interface ViewDependencies {
  highlight: (source: string, language: string) => Promise<string>
  renderDiagram: (source: string) => Promise<Blob>
  loadImage: (url: string, signal: AbortSignal) => Promise<Blob>
  createObjectUrl: (blob: Blob) => string
  revokeObjectUrl: (url: string) => void
  openLink: (url: string) => Promise<void>
  copyCode: (source: string) => void
  labels: () => ViewLabels
}

/** Owns only enhancements of sanitized Markdown and their async lifetimes. */
export function createChatMarkdownView(deps: ViewDependencies) {
  let revision = 0
  let currentRoot: HTMLElement | null = null
  let controller = new AbortController()
  const objectUrls = new Set<string>()
  const diagrams = new Map<string, Promise<Blob>>()
  const images = new Map<string, Blob>()

  function reset() {
    revision += 1
    controller.abort()
    controller = new AbortController()
    objectUrls.forEach((url) => deps.revokeObjectUrl(url))
    objectUrls.clear()
    currentRoot = null
  }

  function objectUrl(blob: Blob) {
    const url = deps.createObjectUrl(blob)
    objectUrls.add(url)
    return url
  }

  function attachImage(button: HTMLButtonElement, blob: Blob) {
    const image = button.parentElement?.querySelector('img')
    if (!image) return
    const placeholder =
      button.parentElement?.querySelector<HTMLElement>('.chat-image-alt')
    image.src = objectUrl(blob)
    image.hidden = false
    if (placeholder) placeholder.hidden = true
    image.onerror = () => {
      image.removeAttribute('src')
      image.hidden = true
      if (placeholder) placeholder.hidden = false
      button.hidden = false
      button.disabled = false
      button.textContent = deps.labels().imageError
    }
    button.hidden = true
  }

  async function enhance(root: HTMLElement, streaming: boolean) {
    reset()
    currentRoot = root
    const version = revision
    const active = () => revision === version && currentRoot === root
    const labels = deps.labels()
    root
      .querySelectorAll<HTMLButtonElement>('[data-image-url]')
      .forEach((button) => {
        const blob = images.get(button.dataset.imageUrl ?? '')
        if (blob) attachImage(button, blob)
      })
    await Promise.all(
      Array.from(root.querySelectorAll('pre')).map(async (pre) => {
        const code = pre.querySelector('code')
        if (!code || code.classList.contains('math-display')) return
        const source = code.textContent ?? ''
        const language =
          Array.from(code.classList)
            .find((name) => name.startsWith('language-'))
            ?.slice(9) ?? ''
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'code-copy'
        button.dataset.codeCopy = 'true'
        button.textContent = labels.copyCode
        pre.append(button)
        if (language.toLowerCase() !== 'mermaid') {
          try {
            const html = await deps.highlight(source, language)
            if (active()) code.innerHTML = html
          } catch {
            // Unknown languages and failed lazy imports remain readable code.
          }
          return
        }
        if (streaming) return
        try {
          let diagram = diagrams.get(source)
          if (!diagram) {
            if (diagrams.size >= 16) diagrams.clear()
            diagram = deps.renderDiagram(source)
            diagrams.set(source, diagram)
          }
          const blob = await diagram
          if (!active()) return
          const figure = document.createElement('figure')
          figure.className = 'chat-diagram'
          const preview = document.createElement('div')
          preview.className = 'chat-diagram-preview'
          const image = document.createElement('img')
          image.alt = labels.diagram
          image.src = objectUrl(blob)
          const details = document.createElement('details')
          const summary = document.createElement('summary')
          summary.textContent = labels.diagramSource
          details.append(summary)
          pre.replaceWith(figure)
          details.append(pre)
          preview.append(image)
          figure.append(preview, details)
        } catch {
          if (!active()) return
          const error = document.createElement('p')
          error.className = 'chat-render-error'
          error.textContent = labels.diagramError
          pre.before(error)
        }
      })
    )
  }

  async function handleClick(event: MouseEvent, root = currentRoot) {
    if (!root || !(event.target instanceof Element)) return
    const anchor = event.target.closest<HTMLAnchorElement>('a')
    if (anchor && root.contains(anchor)) {
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch {
          // Keep malformed fragments literal.
        }
        const target = Array.from(
          root.querySelectorAll<HTMLElement>('[id]')
        ).find((node) => node.id === id)
        if (target) {
          let details = target.closest('details')
          while (details && root.contains(details)) {
            details.open = true
            details = details.parentElement?.closest('details') ?? null
          }
          target.tabIndex = -1
          target.focus({ preventScroll: true })
          target.scrollIntoView({ block: 'nearest' })
        }
      } else if (isChatWebUrl(href)) {
        await deps.openLink(href)
      }
      return
    }
    const button = event.target.closest<HTMLButtonElement>('button')
    if (!button || !root.contains(button)) return
    if (button.dataset.codeCopy) {
      deps.copyCode(
        button.parentElement?.querySelector('code')?.textContent ?? ''
      )
      return
    }
    const url = button.dataset.imageUrl
    if (!url || button.disabled || !isChatWebUrl(url)) return
    const version = revision
    button.disabled = true
    button.textContent = deps.labels().loadingImage
    try {
      const blob = await deps.loadImage(url, controller.signal)
      if (version !== revision) return
      if (images.size >= 16) images.clear()
      images.set(url, blob)
      attachImage(button, blob)
    } catch {
      if (version !== revision) return
      button.disabled = false
      button.textContent = deps.labels().imageError
    }
  }

  return {
    enhance,
    handleClick,
    reset,
    dispose() {
      reset()
      images.clear()
      diagrams.clear()
    },
  }
}
