/** Simple hash function for generating unique IDs. */
function hashSum(value: unknown): string {
  const str = JSON.stringify(value)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  const result = Math.abs(hash).toString(16)
  return result.padStart(8, '0')
}

let counter = Math.floor(Math.random() * 1000000)
let instanceId: string | undefined

function getRuntimeId(): string {
  if (!instanceId) {
    instanceId = hashSum(Math.random().toString() + Date.now().toString())
  }
  return instanceId
}

export function createRuntimeId(): string {
  counter++
  return hashSum(getRuntimeId() + counter.toString())
}
