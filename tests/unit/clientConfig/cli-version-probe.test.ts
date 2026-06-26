import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchDirs } from '../../../src/main/contexts/clientConfig/infrastructure/cli-version-probe'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

describe('searchDirs（常见 CLI 安装目录）', () => {
  it('包含 Bun 默认全局 bin 和 mise Node 安装 bin', async () => {
    root = await mkdtemp(join(tmpdir(), 'hxg-cli-dirs-'))
    const bunBin = join(root, '.bun', 'bin')
    const miseNodeBin = join(root, '.local', 'share', 'mise', 'installs', 'node', '22.15.1', 'bin')
    await mkdir(bunBin, { recursive: true })
    await mkdir(miseNodeBin, { recursive: true })

    const dirs = searchDirs('claude', root)

    expect(dirs).toContain(bunBin)
    expect(dirs).toContain(miseNodeBin)
  })
})
