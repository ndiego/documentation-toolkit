import globals from 'globals';
import wordpress from '@wordpress/eslint-plugin';

export default [
	{
		ignores: [ '**/node_modules/**', '**/.wp-screenshots/**' ],
	},
	...wordpress.configs.recommended,
	{
		files: [ '**/*.js', '**/*.mjs' ],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'module',
			globals: { ...globals.node },
		},
		rules: {
			// The engine is a Node CLI; console output is its user interface.
			'no-console': 'off',
		},
	},
	{
		// The MCP SDK publishes subpath exports (package.json "exports"); the import resolver cannot see them.
		files: [ 'packages/mcp/**/*.js' ],
		rules: {
			'import/no-unresolved': [
				'error',
				{ ignore: [ '^@modelcontextprotocol/sdk/' ] },
			],
		},
	},
	{
		// Code that runs inside the browser page (annotation overlay, page.evaluate callbacks).
		files: [ 'packages/screenshots/src/annotate.js' ],
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
	},
];
