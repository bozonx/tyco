import mermaid from 'mermaid'

import { createChatSvgImage } from './chat-svg'

/** Bound the size and rendering work of diagrams received from a model. */
const MAX_DIAGRAM_CHARACTERS = 50_000
const MAX_DIAGRAM_EDGES = 500

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  theme: 'neutral',
  suppressErrorRendering: true,
  maxTextSize: MAX_DIAGRAM_CHARACTERS,
  maxEdges: MAX_DIAGRAM_EDGES,
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'htmlLabels',
    'theme',
    'themeCSS',
    'themeVariables',
    'flowchart',
    'suppressErrorRendering',
    'maxTextSize',
    'maxEdges',
  ],
})

let nextDiagram = 0

export async function renderChatMermaid(source: string): Promise<Blob> {
  // Model output cannot override the renderer's security or inject CSS.
  if (
    /%%\s*\{/.test(source) ||
    /^\s*---/.test(source) ||
    source.length > MAX_DIAGRAM_CHARACTERS
  ) {
    throw new Error('Diagram configuration directives are not allowed')
  }
  const { svg } = await mermaid.render(`chat-diagram-${++nextDiagram}`, source)
  return createChatSvgImage(svg)
}
