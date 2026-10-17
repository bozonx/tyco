import { describe, expect, it } from 'vitest'
import { imageBudgetCharacters } from './chat-image-input'

describe('chat image input', () => {
  it('budgets large originals more conservatively than resized images', () => {
    expect(imageBudgetCharacters({ width: 1024, height: 1024 })).toBe(4096 * 3)
    expect(
      imageBudgetCharacters({ width: 6000, height: 4000 })
    ).toBeGreaterThan(4096 * 3)
  })
})
