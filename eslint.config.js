import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Flat config (ESLint 10). Type-aware linting is intentionally NOT enabled to
// keep `eslint .` fast across ~600 files; `tsc` already covers type errors via
// `pnpm typecheck`. ESLint focuses on correctness rules tsc does not catch.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'release/**',
      'build/**',
      'tmp/**',
      'test-results/**',
      'coverage/**',
      '**/*.cjs',
      '**/*.jsc',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // typescript-eslint recommends disabling core no-undef for TS: tsc already
      // reports undefined identifiers and understands types / global declarations,
      // whereas no-undef produces false positives on TS-only constructs.
      'no-undef': 'off',
      // ESLint 10 promoted these to "recommended"; they fire heavily on existing
      // (correct) code and are best-practice nudges rather than bugs. Keep them
      // off so the lint baseline stays actionable; revisit as `warn` later.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      // `as any` exists in a handful of places; surface them without blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'require-yield': 'warn',
      // tsc's noUnusedLocals/Parameters already errors on these; keep ESLint as a
      // warning with the conventional underscore escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  // Main process / preload / build configs run in Node.
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'tests/**/*.ts',
      '*.config.{ts,js}',
      'mikro-orm.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  // Renderer runs in the browser; enable React Hooks correctness rules.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Keep ESLint out of Prettier's lane (must stay last).
  prettier,
)
