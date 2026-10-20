import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '../../lib/i18n'
import AudioWaveform from './AudioWaveform.vue'

it('stops scheduling frames when reduced motion is enabled and releases its listener', async () => {
  let onChange: (() => void) | undefined
  const query = {
    matches: false,
    addEventListener: vi.fn((_event: string, handler: () => void) => {
      onChange = handler
    }),
    removeEventListener: vi.fn(),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(
    query as unknown as MediaQueryList
  )
  const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(12)
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(() => {})
  const wrapper = mount(AudioWaveform, { global: { plugins: [i18n] } })
  expect(request).toHaveBeenCalledOnce()
  query.matches = true
  onChange?.()
  expect(cancel).toHaveBeenCalledWith(12)
  await wrapper.setProps({ isTranscribing: true })
  await wrapper.setProps({ isTranscribing: false })
  expect(request).toHaveBeenCalledOnce()
  wrapper.unmount()
  expect(query.removeEventListener).toHaveBeenCalledWith('change', onChange)
})

describe('reduced motion at mount', () => {
  it('does not start an animation loop', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const request = vi.spyOn(window, 'requestAnimationFrame')
    const wrapper = mount(AudioWaveform, { global: { plugins: [i18n] } })
    expect(request).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
