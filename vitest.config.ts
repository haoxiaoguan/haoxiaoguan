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
  },
})
