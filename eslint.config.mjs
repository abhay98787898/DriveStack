import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Keep legacy-code findings visible without making the initial migration
      // fail solely on pre-existing patterns. These can be tightened gradually.
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'next-env.d.ts',
  ]),
]);
