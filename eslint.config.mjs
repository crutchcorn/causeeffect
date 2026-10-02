import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/build',
      '**/coverage',
      '**/out-tsc',
      '**/.nx',
      '**/examples/**',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'scope:jsx-content-mapper',
              onlyDependOnLibsWithTags: ['scope:jsx-content-mapper'],
            },
            {
              sourceTag: 'scope:foldkit-jsx',
              onlyDependOnLibsWithTags: ['scope:foldkit-jsx'],
            },
            {
              sourceTag: 'scope:vsc-extension',
              onlyDependOnLibsWithTags: ['scope:jsx-content-mapper'],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
