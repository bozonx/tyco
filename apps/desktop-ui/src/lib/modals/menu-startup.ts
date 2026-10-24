export function runMenuStartup(deps: {
  getValue: () => string | undefined
  consume: () => void
  run: (value: string) => Promise<void>
}): Promise<void> | undefined {
  const value = deps.getValue()
  if (!value) return
  deps.consume()
  return deps.run(value)
}
