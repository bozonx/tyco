import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const session = process.argv[2] ?? 'x11'
if (!['x11', 'kwin', 'sway'].includes(session)) {
  throw new Error('Expected session: x11, kwin, or sway')
}
const image = 'tyco-platform-tests'
const logDirectory = fileURLToPath(
  new URL(`../platform-logs/${session}/`, import.meta.url)
)
mkdirSync(logDirectory, { recursive: true })
function run(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['build', '-f', 'scripts/linux-platform/Dockerfile', '-t', image, '.'])
run([
  'run',
  '--rm',
  '--init',
  '--network=none',
  '--mount',
  `type=bind,source=${logDirectory},target=/tmp/tyco-platform-logs`,
  ...(session === 'sway'
    ? ['--privileged', '--device=/dev/uinput', '-v', '/dev/input:/dev/input']
    : []),
  image,
  session,
])
