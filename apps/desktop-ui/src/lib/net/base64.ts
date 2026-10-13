/** Encodes in slices: spreading a large array into one call overflows the stack */
const SLICE = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + SLICE))
  }

  return btoa(binary)
}
