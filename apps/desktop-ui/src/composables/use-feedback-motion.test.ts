import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'

import { useFeedbackMotion } from './use-feedback-motion'

afterEach(() => {
  delete document.documentElement.dataset.motion
  delete document.documentElement.dataset.theme
})

function fixture() {
  const step = ref(0)
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = []
  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      const animation = { cancel: vi.fn() }
      animations.push(animation)
      return animation as unknown as Animation
    }
  )
  const wrapper = mount(
    defineComponent({
      setup() {
        const element = ref<HTMLElement | null>(null)
        useFeedbackMotion(() => element.value, step, {
          direction: (next, previous) => (next > previous ? 1 : -1),
          distancePx: 6,
        })
        return () =>
          h(
            'button',
            { ref: element, onClick: () => step.value++ },
            `Step ${step.value}`
          )
      },
    }),
    { attachTo: document.body }
  )
  Object.defineProperty(wrapper.element, 'animate', { value: animate })
  return { step, animations, animate, wrapper }
}

it('cancels superseded feedback and leaves the new action immediately usable', async () => {
  const { step, animations, animate, wrapper } = fixture()
  expect(animate).not.toHaveBeenCalled()
  await wrapper.trigger('click')
  expect(animate).toHaveBeenCalledOnce()
  await wrapper.trigger('click')
  expect(step.value).toBe(2)
  expect(animations[0]!.cancel).toHaveBeenCalledOnce()
  step.value = 1
  await nextTick()
  expect(animate.mock.calls.at(-1)?.[0]).toEqual([
    { opacity: 0.55, transform: 'translateX(-6px)' },
    { opacity: 1, transform: 'translateX(0)' },
  ])
  wrapper.unmount()
  expect(animations.at(-1)!.cancel).toHaveBeenCalledOnce()
})

it('uses a short fade for reduced motion and no animation for e-ink', async () => {
  const { step, animate, wrapper } = fixture()
  document.documentElement.dataset.motion = 'reduce'
  step.value++
  await nextTick()
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 60 })
  expect(animate.mock.calls[0]?.[0]).toEqual([
    { opacity: 0.55, transform: 'translateX(0px)' },
    { opacity: 1, transform: 'translateX(0)' },
  ])
  document.documentElement.dataset.theme = 'eInk'
  step.value++
  await nextTick()
  expect(animate).toHaveBeenCalledOnce()
  wrapper.unmount()
})
