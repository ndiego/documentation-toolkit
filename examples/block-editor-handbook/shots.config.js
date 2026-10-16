// Example project: a slice of the Block Editor Handbook with its screenshot specs kept next to the articles.
// Run from this directory: `npx wp-screenshots doctor`, `npx wp-screenshots run`, `npx wp-screenshots lint`.
export default {
	// Specs live beside their articles as <article>.shots.yaml; the engine does not care where, only what to match.
	specs: [ 'docs/**/*.shots.yaml' ],
	outDir: 'docs/assets/screenshots',
	docsDir: 'docs',
	// The toolkit's demo site: WordPress 7.1, PHP 8.3, the Ipsum theme, the Saltmarsh content pack.
	blueprint: '../../packages/demo-site/blueprint.json',
	workDir: '.wp-screenshots',
	wordpress: { version: '7.1.3', php: '8.3' },
	port: 9400,
	format: 'webp',
	style: {},
};
