import { describe, expect, it } from 'vitest'
import {
  actionRequiresContext,
  isCjkText,
  validateActionText,
} from './action-text-requirement'

describe('action-text-requirement', () => {
  describe('isCjkText', () => {
    it('detects CJK characters', () => {
      expect(isCjkText('你好')).toBe(true)
      expect(isCjkText('こんにちは')).toBe(true)
      expect(isCjkText('안녕하세요')).toBe(true)
      expect(isCjkText('Hello')).toBe(false)
      expect(isCjkText('123')).toBe(false)
    })
  })

  describe('actionRequiresContext', () => {
    it('returns true for actions operating on text', () => {
      expect(actionRequiresContext('correction')).toBe(true)
      expect(actionRequiresContext('directCorrection')).toBe(true)
      expect(actionRequiresContext('transformationMenu')).toBe(true)
      expect(actionRequiresContext('transformation:fix')).toBe(true)
      expect(actionRequiresContext('stylingMenu')).toBe(true)
      expect(actionRequiresContext('styling:formal')).toBe(true)
      expect(actionRequiresContext('translationMenu')).toBe(true)
      expect(actionRequiresContext('translation:de')).toBe(true)
      expect(actionRequiresContext('insertIntoWindow')).toBe(true)
      expect(actionRequiresContext('copyToClipboard')).toBe(true)
      expect(actionRequiresContext('applyToEditor')).toBe(true)
    })

    it('returns false for actions that do not require text', () => {
      expect(actionRequiresContext('openEditor')).toBe(false)
      expect(actionRequiresContext('openHistory')).toBe(false)
      expect(actionRequiresContext('voiceInput')).toBe(false)
      expect(actionRequiresContext('favoritesMenu')).toBe(false)
      expect(actionRequiresContext('quickAiRequest')).toBe(false)
      expect(actionRequiresContext('chatPromptsMenu')).toBe(false)
      expect(actionRequiresContext('chatPrompt:summary')).toBe(false)
      expect(actionRequiresContext(undefined)).toBe(false)
    })
  })

  describe('validateActionText', () => {
    it('passes for non-text actions regardless of text', () => {
      expect(validateActionText('openEditor', '').valid).toBe(true)
      expect(validateActionText('chatPromptsMenu', '').valid).toBe(true)
      expect(validateActionText('quickAiRequest', '').valid).toBe(true)
    })

    it('rejects empty or whitespace-only text for text-requiring actions', () => {
      const res = validateActionText('transformationMenu', '   ')
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('empty')
      expect(res.toastKey).toBe('toast.textNotSelected')
      expect(res.hintKey).toBe('menu.contextRequired')
    })

    it('validates correction minLength', () => {
      const tooShort = validateActionText('correction', 'short')
      expect(tooShort.valid).toBe(false)
      expect(tooShort.reason).toBe('tooShort')
      expect(tooShort.toastKey).toBe('toast.textTooShortForCorrection')
      expect(tooShort.hintKey).toBe('write.textTooShortForCorrection')

      const valid = validateActionText('correction', 'This is long enough')
      expect(valid.valid).toBe(true)
    })

    it('validates transformation minLength', () => {
      const tooShort = validateActionText('transformationMenu', 'a')
      expect(tooShort.valid).toBe(false)
      expect(tooShort.reason).toBe('tooShort')
      expect(tooShort.toastKey).toBe('toast.textTooShortToProcess')
      expect(tooShort.hintKey).toBe('toast.textTooShortToProcess')

      const valid = validateActionText('transformation:fix', 'ab')
      expect(valid.valid).toBe(true)
    })

    it('validates styling minLength', () => {
      const tooShort = validateActionText('stylingMenu', 'a')
      expect(tooShort.valid).toBe(false)
      expect(tooShort.reason).toBe('tooShort')
      expect(tooShort.toastKey).toBe('toast.textTooShortToProcess')

      const valid = validateActionText('styling:formal', 'ab')
      expect(valid.valid).toBe(true)
    })

    it('validates translation minLength with CJK exception', () => {
      const tooShort = validateActionText('translationMenu', 'a')
      expect(tooShort.valid).toBe(false)
      expect(tooShort.reason).toBe('tooShort')
      expect(tooShort.toastKey).toBe('toast.textTooShortToTranslate')

      const validCjkSingle = validateActionText('translationMenu', '字')
      expect(validCjkSingle.valid).toBe(true)

      const validNonCjk = validateActionText('translation:es', 'ab')
      expect(validNonCjk.valid).toBe(true)
    })
  })
})
