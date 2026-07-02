import { writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

// Write to a .tmp sibling then rename. Atomic on POSIX within the same volume.
// On Windows rename fails if dest exists, so we pre-unlink defensively.
//
// The temp name includes a random suffix so two overlapping atomicWrite calls
// for the SAME path (e.g. SettingsFileService.mutate() has no write lock —
// see settings-file-service.ts) never share one temp file. A shared name lets
// one call's writeFile/rename interleave with another's, either corrupting
// the temp file or renaming it away out from under the other call (ENOENT).
// Each call still only ever touches its own temp file; whichever rename
// lands last still simply wins, same as before.
export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(tmp, data)
  if (process.platform === 'win32') {
    await rm(path, { force: true })
  }
  await rename(tmp, path)
}
