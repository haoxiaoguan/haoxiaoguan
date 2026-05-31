import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'

// Unit tests target the Electron main-process (Node) code. The renderer keeps
// its own React/jsdom tests in src/renderer; those are run by the renderer
// toolchain. Here we only run the backend unit tests under tests/unit.
//
// MikroORM decorator entities (contexts/**/infrastructure/*.entity.ts) need
// experimentalDecorators + emitDecoratorMetadata, which vitest's default
// esbuild transform does NOT apply (it keys off the renderer tsconfig). We add
// unplugin-swc — the same transform the main build uses — so decorator metadata
// is emitted and the entities parse + reflect correctly under vitest.
export default defineConfig({
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
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    // unplugin-swc owns the TS transform (it sets esbuild:false). vitest 4
    // routes the default transform through Oxc, which would otherwise strip
    // decorator metadata — disable it so swc is the single transform.
    oxc: false,
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'tests/e2e/**'],
  },
})
