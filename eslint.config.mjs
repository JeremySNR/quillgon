// Lint for correctness, not style: TypeScript's recommended rules and React's rules of hooks.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', 'apps/site/**', 'fixtures/**', 'evals/runs/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // The codebase uses `any` deliberately at JSON boundaries (API bodies, YAML).
      '@typescript-eslint/no-explicit-any': 'off',
      // ignoreRestSiblings: `const { a, ...rest } = x` is how keys are omitted.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
      // A `let` that a closure reads before it is assigned cannot be a const.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      // `cond && fn()` and `(a(), b())` sequences are used as terse statements throughout.
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
