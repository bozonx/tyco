import { describe, expect, it } from 'vitest'

import { resolveScrollBehavior } from './scroll-behavior'

describe('resolveScrollBehavior', () => {
  it('disables smooth scrolling for reduced motion', () => {
    expect(resolveScrollBehavior('smooth', 'reduce')).toBe('instant')
    expect(resolveScrollBehavior('instant', 'reduce')).toBe('instant')
  })

  it('preserves the requested behavior for full motion', () => {
    expect(resolveScrollBehavior('smooth', 'full')).toBe('smooth')
    expect(resolveScrollBehavior('smooth', undefined)).toBe('smooth')
    expect(resolveScrollBehavior('instant', 'full')).toBe('instant')
  })
})
