import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
export default tseslint.config(
    { ignores: ['dist', 'coverage', 'src/shared/api/schema.d.ts'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
        rules: {
            ...hooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            curly: ['error', 'all'],
            'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
            'no-restricted-syntax': [
                'error',
                { selector: 'FunctionDeclaration', message: 'Use arrow functions.' },
                { selector: 'FunctionExpression:not([parent.type=MethodDefinition])', message: 'Use arrow functions.' },
            ],
        },
    },
    {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: { 'no-restricted-imports': ['error', { patterns: ['@/app/*', '@/pages/*', '@/features/*'] }] },
    },
    {
        files: ['src/features/**/*.{ts,tsx}'],
        rules: { 'no-restricted-imports': ['error', { patterns: ['@/app/*', '@/pages/*'] }] },
    }
);
