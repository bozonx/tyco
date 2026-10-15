import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SecretKeyField from './SecretKeyField.vue'
vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
describe('secret key field', () => {
  it('blocks duplicate saves and edits while a secret operation is pending', async () => {
    let resolve!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const remove = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(SecretKeyField, {
      props: { modelValue: 'new-key', hasKey: true, save, remove },
    })
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()
    await buttons[0].trigger('click')
    expect(save).toHaveBeenCalledOnce()
    resolve()
    await flushPromises()
    expect(buttons[0].attributes('disabled')).toBeUndefined()
    await buttons[1].trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
