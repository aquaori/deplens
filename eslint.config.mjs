import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'.agents/**',
			'.codex/**',
			'.deplens/**',
			'.trae/**',
			'assets/**',
			'coverage/**',
			'dist/**',
			'node_modules/**',
			'tests/fixtures/**',
		],
	},
	{
		files: ['**/*.{js,cjs,mjs}'],
		...eslint.configs.recommended,
		languageOptions: {
			ecmaVersion: 'latest',
			globals: globals.node,
		},
		rules: {
			...eslint.configs.recommended.rules,
			'no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				caughtErrorsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],
		},
	},
	...tseslint.configs.recommended.map((config) => ({
		...config,
		files: ['**/*.ts'],
	})),
	{
		files: ['src/**/*.ts', 'tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
				...globals.jest,
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				caughtErrorsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],
		},
	},
);
