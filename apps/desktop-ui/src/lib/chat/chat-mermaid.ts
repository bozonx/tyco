import mermaid from 'mermaid'

import { createChatSvgImage } from './chat-svg'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  theme: 'neutral',
  suppressErrorRendering: true,
  maxTextSize: 50_000,
  maxEdges: 500,
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
    source.length > 50_000
  ) {
    throw new Error('Diagram configuration directives are not allowed')
  }
  const { svg } = await mermaid.render(`chat-diagram-${++nextDiagram}`, source)
  return createChatSvgImage(svg)
}
