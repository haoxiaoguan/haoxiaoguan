import { writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

// Write to a .tmp sibling then rename. Atomic on POSIX within the same volume.
// On Windows rename fails if dest exists, so we pre-unlink defensively.
export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  if (process.platform === 'win32') {
    await rm(path, { force: true })
  }
  await rename(tmp, path)
}
