import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'
import react from '@vitejs/plugin-react'

// Two test projects with disjoint transforms:
//
//  • backend  — Electron main-process (Node) code under tests/unit/**. MikroORM
//    decorator entities need experimentalDecorators + emitDecoratorMetadata,
//    which vitest's default transform does NOT apply. unplugin-swc (the same
//    transform the main build uses) emits decorator metadata so entities reflect
//    correctly. electron is aliased to a stub (no Electron runtime under vitest).
//
//  • renderer — React/jsdom tests under tests/unit/renderer/**. These need the
//    React JSX transform and the `@/` → src/renderer alias the app uses. swc's
//    decorator transform must NOT touch these files, so the projects are split.
//
// Splitting by project keeps the two transforms from fighting over .tsx files.
const backend = {
  extends: true,
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    name: 'backend',
    environment: 'node',
    // unplugin-swc owns the TS transform (it sets esbuild:false). vitest 4
    // routes the default transform through Oxc, which would otherwise strip
    // decorator metadata — disable it so swc is the single transform.
    oxc: false as const,
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'tests/e2e/**', 'tests/unit/renderer/**'],
  },
}

const renderer = {
  extends: true,
  plugins: [react()],
  test: {
    name: 'renderer',
    environment: 'jsdom',
    setupFiles: ['tests/setup/renderer.ts'],
    include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'tests/e2e/**'],
  },
}

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer'),
      // Main-process code imports `electron` statically (bytecode-safe). There is
      // no Electron runtime under vitest, so alias it to a minimal stub.
      electron: resolve(__dirname, 'tests/stubs/electron.ts'),
    },
  },
  test: {
    projects: [backend, renderer],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // 即便有用例失败也产出覆盖率报告（默认 false 会跳过，CI 上不便排查）。
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/*.entity.ts', // ORM 实体：声明式映射，无业务逻辑
        'src/preload/**', // 仅 contextBridge 桥接
        'src/renderer/dev/**', // dev-only mock
      ],
      // 核心域门槛：仅给后端域逻辑设保守下限（防回退，不卡存量）。
      // 取值 = 实测值留 ~6% buffer 后下取整，后续可随测试补充逐步抬高。
      thresholds: {
        // 实测 stmt 88.9 / br 81.7 / fn 90.4 / ln 93.8
        'src/main/contexts/apiProxy/domain/**': {
          statements: 82,
          branches: 73,
          functions: 84,
          lines: 87,
        },
        // 实测 stmt 84.7 / br 62.6 / fn 94.1 / ln 86.6
        'src/main/contexts/account/domain/**': {
          statements: 78,
          branches: 56,
          functions: 87,
          lines: 80,
        },
        // 实测 stmt 80.0 / br 93.9 / fn 89.7 / ln 80.6
        'src/main/contexts/credential/domain/**': {
          statements: 73,
          branches: 85,
          functions: 83,
          lines: 74,
        },
      },
    },
  },
})
