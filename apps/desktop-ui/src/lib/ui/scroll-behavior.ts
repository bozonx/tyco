export function resolveScrollBehavior(
  behavior: 'instant' | 'smooth',
  motion: string | undefined
): 'instant' | 'smooth' {
  return motion === 'reduce' ? 'instant' : behavior
}
