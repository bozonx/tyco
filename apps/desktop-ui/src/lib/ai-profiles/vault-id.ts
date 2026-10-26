import { MAX_VAULT_ID_LENGTH as MAX_ID_LENGTH } from '@tyco/shared'

const defaultRandomSuffix = () => crypto.randomUUID().slice(0, 8)

/** Room left for a counter or a random suffix */
const MAX_SLUG_LENGTH = MAX_ID_LENGTH - 8

/** Letters that lose no accent but have a Latin spelling of their own */
// prettier-ignore
const TRANSLITERATION: Record<string, string> = {
  // Cyrillic: Russian, Ukrainian, Belarusian, Kazakh
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'ng', ө: 'o', ұ: 'u', ү: 'u', һ: 'h',
  // Greek
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
  // Georgian
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch',
  ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
  // Latin letters an accent strip leaves as they are
  ß: 'ss', ı: 'i', ł: 'l', đ: 'd', ø: 'o', æ: 'ae', œ: 'oe', þ: 'th',
}

const transliterate = (text: string) =>
  Array.from(text, (char) => TRANSLITERATION[char] ?? char).join('')

/**
 * The folder name a name spells in Latin letters, digits, `-` and `_`; empty
 * when nothing of it can be spelled so, e.g. for Chinese
 */
export function slugifyVaultName(name: string): string {
  // before the accents go, as some letters spell differently with them
  // (й, ї); after, for accented letters missing from the table (ό, ή)
  const latin = transliterate(
    transliterate(name.toLowerCase().trim())
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
  )
  return latin
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
}

/**
 * The folder name of a new profile or project. It comes from the name when it
 * can be spelled in Latin letters; otherwise from `fallback` and a random
 * suffix. Taken ids get a counter.
 */
export function createVaultId(
  name: string,
  fallback: string,
  takenIds: readonly string[],
  randomSuffix: () => string = defaultRandomSuffix
): string {
  const base = slugifyVaultName(name) || `${fallback}-${randomSuffix()}`
  const taken = new Set(takenIds)
  let candidate = base
  let counter = 1
  while (taken.has(candidate)) {
    candidate = `${base}-${counter++}`
  }
  return candidate
}
