#!/usr/bin/env node
import fs from 'node:fs';
import { validateManifest, isPlainObject } from './validate.js';

const HELP = `wp-validate-manifest: validate a handbook manifest.json for the wporg-markdown importer

Usage: wp-validate-manifest <manifest> [--docs DIR] [--frozen FILE]
                            [--allow-missing-parent KEY ...] [--strict]

Checks the invariants that have broken real imports on developer.wordpress.org:

  - the manifest is a JSON object keyed by page path (not the Gutenberg list format)
  - keys are unique, normalised (no leading/trailing slash), and parents precede children
  - parent is null or an existing key (path form), except keys listed in --allow-missing-parent
  - a new entry's slug never equals another entry's slug at a different path (the importer's slug
    fallback would silently take over the existing post)
  - order is an integer; with --frozen, existing keys keep their frozen order (0 is never re-applied)
  - markdown_source is a github.com/<org>/<repo>/blob/<branch>/... URL (raw URLs break the edit link)
  - with --docs DIR: each source file exists, starts with exactly one '# Title' equal to title,
    contains no other H1, and has no unescaped '<!-- wp:' outside fenced code (it would disable wpautop)
  - with --frozen FILE: no key from the frozen list is missing or renamed (removals need a redirect PR)

Options
  --docs DIR                     Root directory the markdown_source paths resolve under (repo checkout)
  --frozen FILE                  JSON list of keys that must all still exist (or an object with their order)
  --allow-missing-parent KEY...  Keys whose parent is intentionally absent
  --strict                       Treat warnings as errors
  -h, --help                     Show this help

Exit code 1 on any error. Warnings do not fail the run unless --strict.
`;

const USAGE =
	'usage: wp-validate-manifest [-h] [--docs DOCS] [--frozen FROZEN] [--allow-missing-parent [KEY ...]] [--strict] manifest';

/**
 * Parse the command line.
 *
 * @param {string[]} argv Arguments after the script path.
 * @return {{ manifest: string|null, docs: string|null, frozen: string|null, allowMissingParent: string[], strict: boolean, help: boolean }} The parsed options.
 * @throws {Error} On an unknown flag, a missing flag value, or a second positional argument.
 */
function parseArgs( argv ) {
	const args = {
		manifest: null,
		docs: null,
		frozen: null,
		allowMissingParent: [],
		strict: false,
		help: false,
	};
	const positional = [];
	let i = 0;
	let onlyPositional = false;

	const takeValue = ( flag ) => {
		if ( i + 1 >= argv.length ) {
			throw new Error( `argument ${ flag }: expected one argument` );
		}
		i++;
		return argv[ i ];
	};

	while ( i < argv.length ) {
		const arg = argv[ i ];
		if ( onlyPositional || ! arg.startsWith( '-' ) || arg === '-' ) {
			positional.push( arg );
		} else if ( arg === '--' ) {
			onlyPositional = true;
		} else if ( arg === '-h' || arg === '--help' ) {
			args.help = true;
		} else if ( arg === '--strict' ) {
			args.strict = true;
		} else if ( arg === '--docs' ) {
			args.docs = takeValue( arg );
		} else if ( arg.startsWith( '--docs=' ) ) {
			args.docs = arg.slice( '--docs='.length );
		} else if ( arg === '--frozen' ) {
			args.frozen = takeValue( arg );
		} else if ( arg.startsWith( '--frozen=' ) ) {
			args.frozen = arg.slice( '--frozen='.length );
		} else if ( arg === '--allow-missing-parent' ) {
			while ( i + 1 < argv.length && ! argv[ i + 1 ].startsWith( '-' ) ) {
				i++;
				args.allowMissingParent.push( argv[ i ] );
			}
		} else if ( arg.startsWith( '--allow-missing-parent=' ) ) {
			args.allowMissingParent.push(
				arg.slice( '--allow-missing-parent='.length )
			);
		} else {
			throw new Error( `unrecognized arguments: ${ arg }` );
		}
		i++;
	}

	if ( positional.length > 1 ) {
		throw new Error(
			`unrecognized arguments: ${ positional.slice( 1 ).join( ' ' ) }`
		);
	}
	args.manifest = positional[ 0 ] ?? null;
	return args;
}

/**
 * Read and parse a JSON file.
 *
 * @param {string} filePath Path to the file.
 * @return {unknown} The parsed value.
 */
function readJson( filePath ) {
	return JSON.parse( fs.readFileSync( filePath, 'utf8' ) );
}

/**
 * Run the validator with the given arguments and print the report.
 *
 * @param {string[]} argv Arguments after the script path.
 * @return {number} The exit code.
 */
function main( argv ) {
	let args;
	try {
		args = parseArgs( argv );
	} catch ( err ) {
		console.error( USAGE );
		console.error( `wp-validate-manifest: error: ${ err.message }` );
		return 2;
	}
	if ( args.help ) {
		process.stdout.write( HELP );
		return 0;
	}
	if ( ! args.manifest ) {
		console.error( USAGE );
		console.error(
			'wp-validate-manifest: error: the following arguments are required: manifest'
		);
		return 2;
	}

	let data;
	try {
		data = readJson( args.manifest );
	} catch ( err ) {
		console.log( `error: cannot read manifest: ${ err.message }` );
		return 1;
	}
	if ( ! isPlainObject( data ) ) {
		console.log(
			'error: manifest must be a JSON object keyed by page path (list manifests cannot express duplicate slugs)'
		);
		return 1;
	}

	let frozen;
	if ( args.frozen ) {
		try {
			frozen = readJson( args.frozen );
		} catch ( err ) {
			console.log( `error: cannot read frozen list: ${ err.message }` );
			return 1;
		}
		if ( ! Array.isArray( frozen ) && ! isPlainObject( frozen ) ) {
			console.log(
				'error: frozen list must be a JSON list of keys or an object keyed by page path'
			);
			return 1;
		}
	}

	const { errors, warnings, entries } = validateManifest( data, {
		docs: args.docs,
		frozen,
		allowMissingParent: args.allowMissingParent,
	} );

	for ( const w of warnings ) {
		console.log( `warning: ${ w }` );
	}
	for ( const e of errors ) {
		console.log( `error: ${ e }` );
	}
	console.log(
		`${ entries } entries, ${ errors.length } errors, ${ warnings.length } warnings`
	);
	return errors.length || ( args.strict && warnings.length ) ? 1 : 0;
}

process.exitCode = main( process.argv.slice( 2 ) );
