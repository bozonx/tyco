import { describe, expect, it } from 'vitest'

import { renderChatMarkdown } from './chat-markdown'

describe('chat-markdown', () => {
  it('renders GFM content', () => {
    const html = renderChatMarkdown('**Bold**\n\n- one\n- two')

    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('keeps fenced code language classes', () => {
    expect(renderChatMarkdown('```ts\nconst answer = 42\n```')).toContain(
      'class="language-ts"'
    )
  })

  it('removes unsafe markup', () => {
    const html = renderChatMarkdown(
      '[x](javascript:alert(1))\n<script>x</script>'
    )

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<script>')
  })
})
