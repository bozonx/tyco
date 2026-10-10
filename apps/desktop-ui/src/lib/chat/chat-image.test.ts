import { describe, expect, it, vi } from 'vitest'

import { loadChatImage } from './chat-image'

describe('loadChatImage', () => {
  it('uses the proxy transport without credentials and preserves the image MIME type', async () => {
    const fetchImage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2]), {
          headers: { 'content-type': 'image/png; charset=binary' },
        })
      )
    const signal = new AbortController().signal
    const image = await loadChatImage(
      'https://example.com/image.png',
      signal,
      fetchImage
    )
    expect(fetchImage).toHaveBeenCalledWith('https://example.com/image.png', {
      signal,
      credentials: 'omit',
    })
    expect(image.type).toBe('image/png')
    expect(image.size).toBe(2)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com/image.png',
  ])('rejects %s before fetching', async (url) => {
    const fetchImage = vi.fn<typeof fetch>()
    await expect(
      loadChatImage(url, new AbortController().signal, fetchImage)
    ).rejects.toThrow('Unsupported image URL')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it.each<ResponseInit>([
    { status: 404, headers: { 'content-type': 'image/png' } },
    { headers: { 'content-type': 'text/html' } },
    {
      headers: {
        'content-type': 'image/png',
        'content-length': String(11 * 1024 * 1024),
      },
    },
  ])('rejects unsupported image responses: %j', async (init) => {
    const fetchImage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('image', init))
    await expect(
      loadChatImage(
        'https://example.com/image.png',
        new AbortController().signal,
        fetchImage
      )
    ).rejects.toThrow('Unsupported image response')
  })

  it('loads SVG images through the proxy and removes active content', async () => {
    const fetchImage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50"/><script>alert(1)</script><image href="https://evil.test/x"/></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      )
    const image = await loadChatImage(
      'https://example.com/image.svg',
      new AbortController().signal,
      fetchImage
    )
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(image)
    })
    expect(image.type).toBe('image/svg+xml')
    expect(text).toContain('<rect')
    expect(text).not.toContain('<script')
    expect(text).not.toContain('https://evil.test')
  })

  it('cancels oversized streamed bodies even without a content length', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(11 * 1024 * 1024))
      },
      cancel,
    })
    const fetchImage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { headers: { 'content-type': 'image/png' } })
      )
    await expect(
      loadChatImage(
        'https://example.com/image.png',
        new AbortController().signal,
        fetchImage
      )
    ).rejects.toThrow('Image size limit exceeded')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
