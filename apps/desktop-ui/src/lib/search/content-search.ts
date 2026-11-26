export interface ContentSearchMatch {
  range: Range
  element: HTMLElement
}

export interface ContentSearchSession {
  readonly query: string
  readonly matchCase: boolean
  readonly matches: readonly ContentSearchMatch[]
  readonly count: number
  readonly activeIndex: number
  readonly activeMatch: ContentSearchMatch | null
  next(): ContentSearchMatch | null
  previous(): ContentSearchMatch | null
  goTo(index: number): ContentSearchMatch | null
  destroy(): void
}

/**
 * Traverses text nodes within container to locate all occurrences of query.
 * Skips search UI, buttons, inputs, scripts and hidden elements.
 */
export function findContentMatches(
  container: HTMLElement,
  query: string,
  options?: { matchCase?: boolean }
): ContentSearchMatch[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const matchCase = options?.matchCase ?? false
  const doc = container.ownerDocument
  const needle = matchCase ? trimmed : trimmed.toLowerCase()
  const needleLen = trimmed.length

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (
        parent.closest(
          '.content-search-bar, button, input, textarea, select, script, style, [hidden], .no-search'
        )
      ) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const matches: ContentSearchMatch[] = []
  let currentNode = walker.nextNode()

  while (currentNode) {
    const text = currentNode.textContent ?? ''
    const haystack = matchCase ? text : text.toLowerCase()
    let startIndex = 0

    while (startIndex < haystack.length) {
      const matchIndex = haystack.indexOf(needle, startIndex)
      if (matchIndex === -1) break

      try {
        const range = doc.createRange()
        range.setStart(currentNode, matchIndex)
        range.setEnd(currentNode, matchIndex + needleLen)
        const element =
          currentNode.parentElement instanceof HTMLElement
            ? currentNode.parentElement
            : container
        matches.push({ range, element })
      } catch {
        // Skip errors on detached/unsupported nodes
      }

      startIndex = matchIndex + needleLen
    }

    currentNode = walker.nextNode()
  }

  return matches
}

export function createContentSearchSession(
  container: HTMLElement,
  query: string,
  options?: { matchCase?: boolean; initialIndex?: number }
): ContentSearchSession {
  const matchCase = options?.matchCase ?? false
  const matches = findContentMatches(container, query, { matchCase })
  let activeIndex =
    matches.length > 0
      ? Math.max(0, Math.min(options?.initialIndex ?? 0, matches.length - 1))
      : -1

  const updateHighlights = () => {
    if (
      typeof Highlight !== 'undefined' &&
      typeof CSS !== 'undefined' &&
      'highlights' in CSS
    ) {
      if (matches.length === 0) {
        CSS.highlights.delete('content-search-match')
        CSS.highlights.delete('content-search-match-current')
        return
      }

      const allRanges = matches.map((m) => m.range)
      const allHighlight = new Highlight(...allRanges)
      CSS.highlights.set('content-search-match', allHighlight)

      const active = matches[activeIndex]
      if (active) {
        const currentHighlight = new Highlight(active.range)
        CSS.highlights.set('content-search-match-current', currentHighlight)
      } else {
        CSS.highlights.delete('content-search-match-current')
      }
    }
  }

  const scrollToActive = () => {
    const active = matches[activeIndex]
    if (active) {
      active.element.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
  }

  updateHighlights()
  if (activeIndex >= 0) {
    scrollToActive()
  }

  return {
    get query() {
      return query
    },
    get matchCase() {
      return matchCase
    },
    get matches() {
      return matches
    },
    get count() {
      return matches.length
    },
    get activeIndex() {
      return activeIndex
    },
    get activeMatch() {
      return matches[activeIndex] ?? null
    },
    next() {
      if (matches.length === 0) return null
      activeIndex = (activeIndex + 1) % matches.length
      updateHighlights()
      scrollToActive()
      return matches[activeIndex]
    },
    previous() {
      if (matches.length === 0) return null
      activeIndex = (activeIndex - 1 + matches.length) % matches.length
      updateHighlights()
      scrollToActive()
      return matches[activeIndex]
    },
    goTo(index: number) {
      if (index < 0 || index >= matches.length) return null
      activeIndex = index
      updateHighlights()
      scrollToActive()
      return matches[activeIndex]
    },
    destroy() {
      if (
        typeof Highlight !== 'undefined' &&
        typeof CSS !== 'undefined' &&
        'highlights' in CSS
      ) {
        CSS.highlights.delete('content-search-match')
        CSS.highlights.delete('content-search-match-current')
      }
    },
  }
}
