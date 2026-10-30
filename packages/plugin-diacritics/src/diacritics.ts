const DIACRITICS = {
  acute: '\u0301',
  grave: '\u0300',
  circumflex: '\u0302',
  diaeresis: '\u0308',
  tilde: '\u0303',
  caron: '\u030c',
  macron: '\u0304',
} as const
export type Diacritic = keyof typeof DIACRITICS

/** Apply once to letters in the selection, including precomposed characters. */
export function addDiacritic(text: string, kind: Diacritic): string {
  const mark = DIACRITICS[kind]
  return text
    .normalize('NFD')
    .replace(/\p{L}\p{M}*/gu, (letter) =>
      letter.includes(mark) ? letter : letter + mark
    )
    .normalize('NFC')
}

/** Stress marks: the only marks that are not part of a Cyrillic letter. */
const STRESS_MARKS = /[\u0300\u0301]/gu

/**
 * Removes combining diacritics from letters. Spacing characters that Unicode
 * also counts as diacritics (`^`, a backtick) are text, so they stay. In
 * Cyrillic only stress is removed: й, ё, ї and ў are letters of the alphabet,
 * as are the voiced kana of Japanese.
 */
export function clearDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/(\p{L})(\p{M}+)/gu, (_cluster, base: string, marks: string) => {
      if (/\p{Script=Cyrillic}/u.test(base))
        return base + marks.replace(STRESS_MARKS, '')
      if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(base))
        return base + marks
      return base + marks.replace(/(?=\p{Diacritic})\p{M}/gu, '')
    })
    .normalize('NFC')
}

/** Remove only the acute accent, preserving other marks such as breve and tilde. */
export function clearAcute(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\u0301/gu, '')
    .normalize('NFC')
}
