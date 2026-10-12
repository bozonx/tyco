// SemVer 2.0: numeric prerelease identifiers cannot have leading zeroes.
const number = '(?:0|[1-9]\\d*)'
const prerelease = `(?:${number}|[\\dA-Za-z-]*[A-Za-z-][\\dA-Za-z-]*)`
const semver = new RegExp(
  `^${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[\\dA-Za-z-]+(?:\\.[\\dA-Za-z-]+)*)?$`
)

/** @param {unknown} version */
export function validateVersion(version) {
  if (
    typeof version !== 'string' ||
    version !== version.trim() ||
    !semver.test(version)
  ) {
    throw new Error(`Invalid version in package.json: ${version}`)
  }
  return version
}

/** @param {string} raw */
export function cargoPackageVersion(raw) {
  const section =
    /^\[package\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(raw)
  const match = section?.[1].match(/^(version\s*=\s*")([^"]+)("[^\r\n]*)$/m)
  if (
    !section ||
    !match ||
    match.index === undefined ||
    section.index === undefined
  ) {
    throw new Error('Missing string version in Cargo.toml [package] section')
  }
  const offset = section.index + section[0].indexOf('\n') + 1 + match.index
  return {
    version: match[2],
    offset,
    line: match[0],
    prefix: match[1],
    suffix: match[3],
  }
}

/**
 * @param {string} raw
 * @param {string} version
 */
export function updateCargoVersion(raw, version) {
  validateVersion(version)
  const current = cargoPackageVersion(raw)
  return (
    raw.slice(0, current.offset) +
    current.prefix +
    version +
    current.suffix +
    raw.slice(current.offset + current.line.length)
  )
}
