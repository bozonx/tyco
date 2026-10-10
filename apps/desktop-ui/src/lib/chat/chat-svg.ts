import DOMPurify from 'dompurify'

/** Return an inert SVG image without active content or external resources. */
export function createChatSvgImage(source: string): Blob {
  const safe = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script'],
    FORBID_ATTR: ['href', 'xlink:href'],
  })
  const document = new DOMParser().parseFromString(safe, 'image/svg+xml')
  const svg = document.documentElement
  if (svg.localName !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('Invalid SVG image')
  }
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // Explicit dimensions prevent browsers from scaling diagrams to a 300px default.
  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    const scale = Math.min(1, 4096 / Math.max(viewBox[2], viewBox[3]))
    svg.setAttribute('width', String(Math.ceil(viewBox[2] * scale)))
    svg.setAttribute('height', String(Math.ceil(viewBox[3] * scale)))
  }
  return new Blob([new XMLSerializer().serializeToString(svg)], {
    type: 'image/svg+xml',
  })
}
