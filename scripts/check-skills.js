#!/usr/bin/env node
/**
 * Check the plugin manifest and every skill: valid JSON, SKILL.md present, frontmatter with `name` equal to
 * the directory name and a non-empty `description`, and no reference to a path that only exists in a
 * consuming repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);
const problems = [];

for ( const file of [ 'plugin.json', 'marketplace.json' ] ) {
	try {
		const data = JSON.parse(
			fs.readFileSync( path.join( root, '.claude-plugin', file ), 'utf8' )
		);
		if ( ! data.name ) {
			problems.push( `${ file }: missing "name"` );
		}
	} catch ( e ) {
		problems.push( `${ file }: ${ e.message }` );
	}
}

const skillsDir = path.join( root, 'skills' );
for ( const dir of fs.readdirSync( skillsDir ) ) {
	const file = path.join( skillsDir, dir, 'SKILL.md' );
	if ( ! fs.existsSync( file ) ) {
		problems.push( `skills/${ dir }: no SKILL.md` );
		continue;
	}
	const text = fs.readFileSync( file, 'utf8' );
	const match = text.match( /^---\n([\s\S]*?)\n---\n/ );
	if ( ! match ) {
		problems.push( `skills/${ dir }: no frontmatter` );
		continue;
	}
	const name = match[ 1 ].match( /^name:\s*(.+)$/m )?.[ 1 ].trim();
	const description = match[ 1 ]
		.match( /^description:\s*(.+)$/m )?.[ 1 ]
		.trim();
	if ( name !== dir ) {
		problems.push(
			`skills/${ dir }: name "${ name }" must equal the directory name`
		);
	}
	if ( ! description ) {
		problems.push( `skills/${ dir }: missing description` );
	}
	for ( const stale of [
		'toolkit/wp-shots',
		'wp-shots ',
		'screenshots/README.md',
		'validate_manifest.py',
	] ) {
		if ( text.includes( stale ) ) {
			problems.push(
				`skills/${ dir }: references "${ stale }", which no longer exists`
			);
		}
	}
}

for ( const p of problems ) {
	console.error( `error: ${ p }` );
}
console.log( `${ problems.length } problem(s)` );
process.exit( problems.length ? 1 : 0 );
