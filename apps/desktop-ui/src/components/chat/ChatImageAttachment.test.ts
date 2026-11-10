import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatImageAttachment from './ChatImageAttachment.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

import { installFakeDesktop } from '../../test/install-fake-desktop'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  profileId: undefined as string | undefined,
}))
vi.mock('../../composables/use-chat-scope', () => ({
  useChatScopeProfileId: () => mocks.profileId,
}))
vi.mock('../../lib/chat/chat-image-storage', () => ({
  getChatImage: mocks.get,
}))
vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const image = {
  id: 'image',
  mediaType: 'image/webp' as const,
  width: 1,
  height: 1,
  size: 3,
}

describe('image attachment preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profileId = undefined
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      }),
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      }),
    })
  })
  it('loads local bytes and releases the object URL on unmount', async () => {
    mocks.get.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ChatImageAttachment, {
      props: { image, removable: true },
    })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    await wrapper.get('.remove-image').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })
  it('shows a localized error when stored bytes are missing', async () => {
    mocks.get.mockRejectedValue(new Error('Missing image'))
    const wrapper = mount(ChatImageAttachment, { props: { image } })
    await flushPromises()
    expect(wrapper.text()).toContain('chat.imageUnavailable')
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
  it('retries a failed image on click with its own media type', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('Busy'))
      .mockResolvedValueOnce(new Uint8Array([1]))
    const wrapper = mount(ChatImageAttachment, {
      props: { image: { ...image, mediaType: 'image/webp' } },
    })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/webp')
    wrapper.unmount()
  })
  it.each([undefined, 'profile-1'])(
    'retries a missing image when its file arrives (profile: %s)',
    async (profileId) => {
      mocks.profileId = profileId
      const changed = (file: string) =>
        profileId
          ? {
              paths: [],
              vaultChanges: [
                {
                  vaultId: '',
                  path: `profiles/${profileId}/chats/images/${file}`,
                },
              ],
            }
          : { paths: [`chats/images/${file}`], vaultChanges: [] }
      const desktop = installFakeDesktop()
      mocks.get
        .mockRejectedValueOnce(new Error('Missing image'))
        .mockResolvedValueOnce(new Uint8Array([1]))
      const wrapper = mount(ChatImageAttachment, { props: { image } })
      try {
        await flushPromises()
        expect(wrapper.text()).toContain('chat.imageUnavailable')
        await desktop.emit(
          DESKTOP_EVENTS.STORAGE_CHANGED,
          changed('another.webp')
        )
        await flushPromises()
        expect(mocks.get).toHaveBeenCalledTimes(1)
        await desktop.emit(
          DESKTOP_EVENTS.STORAGE_CHANGED,
          changed('image.webp')
        )
        await flushPromises()
        expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
        await desktop.emit(
          DESKTOP_EVENTS.STORAGE_CHANGED,
          changed('image.webp')
        )
        await flushPromises()
        expect(mocks.get).toHaveBeenCalledTimes(2)
      } finally {
        wrapper.unmount()
        desktop.dispose()
      }
    }
  )
  it('does not allocate an object URL after disposal', async () => {
    let finish!: (bytes: Uint8Array) => void
    mocks.get.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const wrapper = mount(ChatImageAttachment, { props: { image } })
    wrapper.unmount()
    finish(new Uint8Array([1]))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('opens the fullscreen image viewer on click and supports large thumbnails', async () => {
    mocks.get.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const wrapper = mount(ChatImageAttachment, {
      props: { image, size: 'large' },
    })
    await flushPromises()
    expect(wrapper.find('.image-attachment.is-large').exists()).toBe(true)

    await wrapper.get('.image-preview-btn').trigger('click')
    await flushPromises()
    const dialog = document.body.querySelector('dialog.image-viewer-dialog')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(
      'blob:preview'
    )

    dialog.querySelector<HTMLButtonElement>('.image-viewer-close')!.click()
    await flushPromises()
    expect(dialog.hasAttribute('open')).toBe(false)
    wrapper.unmount()
  })
})
