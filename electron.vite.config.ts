import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import swc from 'unplugin-swc'

// MikroORM decorator entities require emitDecoratorMetadata, which esbuild does
// not support. unplugin-swc provides it for the main build. Entity files must
// NOT be name-mangled (MikroORM reflects on class/property names), so we leave
// minification off for the main bundle.
export default defineConfig({
  main: {
    plugins: [
      // MikroORM entities use legacy (experimental) decorators and require
      // emitDecoratorMetadata. swc.vite() with no options does not enable these,
      // so configure the same jsc transform used by vitest.config.ts.
      swc.vite({
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          keepClassNames: true,
        },
      }),
      externalizeDepsPlugin(),
      bytecodePlugin(),
    ],
    build: {
      minify: false,
      rollupOptions: {
        // package.json has "type": "module", which makes electron-vite emit
        // ESM by default. bytecodePlugin only supports CommonJS, so we pin the
        // main bundle to cjs; electron-vite emits a .js loader stub + .jsc
        // bytecode. minify stays off so MikroORM entity class/property names
        // survive for decorator-metadata reflection.
        output: { format: 'cjs' },
        input: { main: resolve(__dirname, 'src/main/main.ts') },
      },
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()],
    build: {
      rollupOptions: {
        // Same as main: cjs output so bytecodePlugin can emit .jsc.
        output: { format: 'cjs' },
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      // 数组形式以便用「精确正则」alias monaco——`import * as monaco from 'monaco-editor'`
      // 默认解析到完整 editor.main，会把 ts/css/html 语言及其 worker(~13.7M)全打进包。
      // 本应用只编辑 JSON：把裸 `monaco-editor` 精确指向核心 editor.api（不挂任何语言），
      // JSON 语言由 json-editor.tsx 具名导入 contribution 单独注册。子路径导入
      //（esm/vs/...、?worker）不匹配 `^monaco-editor$`，照常解析。
      alias: [
        { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
        { find: '@', replacement: resolve(__dirname, 'src/renderer') },
        {
          find: /^monaco-editor$/,
          replacement: resolve(__dirname, 'node_modules/monaco-editor/esm/vs/editor/editor.api.js'),
        },
      ],
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
