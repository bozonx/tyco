export const DIACRITICS = {
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

/** Explicit removal of all combining diacritics; can change alphabet letters. */
export function clearDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
}

/** Remove only the acute accent, preserving other marks such as breve and tilde. */
export function clearAcute(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\u0301/gu, '')
    .normalize('NFC')
}
