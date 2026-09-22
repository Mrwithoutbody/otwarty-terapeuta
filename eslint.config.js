import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.wrangler/**',
      'node_modules/**',
      'worker-configuration.d.ts',
      'apps/mcp/widget/generated.ts',
      'apps/panel/authored/tool-generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.mjs', '**/test/**/*.ts'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  // Granice obszarów: apps/<x> importuje tylko z shared/, shared/ nie sięga do apps/.
  // Testy i worker.ts (korzeń kompozycji) są wolne.
  ...[
    ['shared', '(^|/)apps(/|$)', 'shared/ nie importuje z apps/.'],
    ['apps/portal', '(^|/)(panel|mcp)(/|$)', 'Obszar importuje tylko z shared/.'],
    ['apps/panel', '(^|/)(portal|mcp)(/|$)', 'Obszar importuje tylko z shared/.'],
    ['apps/mcp', '(^|/)(portal|panel)(/|$)', 'Obszar importuje tylko z shared/.'],
  ].map(([dir, regex, message]) => ({
    files: [`${dir}/**/*.{ts,tsx}`],
    ignores: [`${dir}/**/test/**`],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ regex, message }] }] },
  })),
);
