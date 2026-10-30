import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  initialize: vi.fn((settings: Record<string, unknown>) => {
    mock.settings = settings
  }),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({ default: mock }))

import { renderChatMermaid } from './chat-mermaid'

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsText(blob)
  })
}

describe('chat-mermaid', () => {
  it('initializes an offline strict renderer without HTML labels or automatic DOM scanning', () => {
    expect(mock.settings).toEqual(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        suppressErrorRendering: true,
      })
    )
  })

  it('sanitizes diagrams before returning an inert SVG image', async () => {
    mock.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div>HTML</div></foreignObject><image href="https://evil.test/x"/><a href="javascript:alert(1)"><text onclick="alert(1)">Safe</text></a><path d="M0 0L10 10"/></svg>',
    })
    const blob = await renderChatMermaid('graph TD; A-->B')
    const svg = await readBlob(blob)
    expect(blob.type).toBe('image/svg+xml')
    expect(svg).toContain('<path')
    expect(svg).toContain('Safe')
    for (const forbidden of [
      '<script',
      '<foreignObject',
      '<image',
      '<a ',
      'onclick',
      'javascript:',
      'https://evil.test',
    ])
      expect(svg).not.toContain(forbidden)
  })

  it.each([
    '%%{init: {"securityLevel":"loose"}}%%\ngraph TD; A-->B',
    '---\nconfig:\n  securityLevel: loose\n---\ngraph TD; A-->B',
    'x'.repeat(50_001),
  ])(
    'rejects configuration overrides and oversized diagrams',
    async (source) => {
      const count = mock.render.mock.calls.length
      await expect(renderChatMermaid(source)).rejects.toThrow(
        'Diagram configuration directives are not allowed'
      )
      expect(mock.render.mock.calls.length).toBe(count)
    }
  )
})
