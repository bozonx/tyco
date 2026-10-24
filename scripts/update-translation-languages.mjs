import { readFile, writeFile } from 'node:fs/promises'

const sources = {
  registry:
    'https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry',
  deepl:
    'https://raw.githubusercontent.com/DeepL/api-docs/main/snippets/language-table.jsx',
  google: 'https://docs.cloud.google.com/translate/docs/languages',
}
const paths = process.argv.slice(2)
if (paths.length !== 0 && paths.length !== 3)
  throw new Error(
    'Pass no arguments, or the IANA, DeepL and Google source file paths'
  )
const contents = await Promise.all(
  Object.values(sources).map(async (url, index) => {
    if (paths[index]) return readFile(paths[index], 'utf8')
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`Failed to retrieve ${url}: ${response.status}`)
    return response.text()
  })
)
const [registry, deepl, google] = contents
/** @type {Record<string, string>} */
const llm = {}
const excluded = new Set(['und', 'mul', 'zxx', 'mis'])
for (const record of registry.split('%%')) {
  const fields = new Map(
    [...record.matchAll(/^([\w-]+): (.+)$/gm)].map((match) => [
      match[1],
      match[2],
    ])
  )
  const id = fields.get('Subtag')
  if (
    fields.get('Type') !== 'language' ||
    !id ||
    fields.has('Deprecated') ||
    fields.get('Scope') === 'collection' ||
    excluded.has(id) ||
    !/^[a-z]{2,3}$/.test(id)
  )
    continue
  llm[id] = fields.get('Description') ?? id
}
/** @param {string} code */
const canonical = (code) => Intl.getCanonicalLocales(code.toLowerCase())[0]
/** @type {Record<string, string>} */
const deeplSource = {}
/** @type {Record<string, string>} */
const deeplTarget = {}
for (const match of deepl.matchAll(
  /\{ code: '([^']+)', name: '([^']+)', translation: true, isVariant: (true|false)/g
)) {
  const id = canonical(match[1])
  deeplTarget[id] = match[2]
  if (match[3] === 'false') deeplSource[id] = match[2]
}
/** @type {Record<string, string>} */
const googleLanguages = {}
const nmt = google.slice(google.indexOf('<h2 id="nmt"'))
const table = nmt.match(/<table[\s\S]*?<\/table>/)?.[0] ?? ''
for (const row of table.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
  const name = row[0].match(/<td[^>]*>([^<]+)<\/td>/)?.[1]?.trim()
  const codes = [...row[0].matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(
    (match) => match[1]
  )
  if (!name || !codes.length) continue
  // Prefer canonical BCP 47 spellings over Google's accepted legacy aliases.
  for (const code of codes) googleLanguages[canonical(code)] = name
}
if (
  Object.keys(llm).length < 7000 ||
  Object.keys(deeplTarget).length < 100 ||
  Object.keys(googleLanguages).length < 180
)
  throw new Error(
    'Unexpected language source structure; refusing to replace snapshots'
  )
const directory = new URL(
  '../apps/desktop-ui/src/lib/translation/languages/',
  import.meta.url
)
for (const [file, value] of Object.entries({
  'iana.json': llm,
  'deepl.json': { source: deeplSource, target: deeplTarget },
  'google.json': { source: googleLanguages, target: googleLanguages },
  'sources.json': {
    retrievedAt: new Date().toISOString().slice(0, 10),
    registryDate: registry.match(/^File-Date: (.+)/)?.[1],
    sources,
  },
})) {
  await writeFile(
    new URL(file, directory),
    `${JSON.stringify(value, null, 2)}\n`
  )
}
