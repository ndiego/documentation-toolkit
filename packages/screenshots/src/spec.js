import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { verbNames } from './actions.js';
import { sceneNames, parseScene } from './scenes.js';
import { validateTargetName } from './targets.js';
import { validateLocatorKey } from './locators.js';
import { walk } from './files.js';
import { frameNames } from './style.js';
import { expandPreset, presetNames, presetParamNames } from './presets.js';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const KINDS = new Set( [ 'image', 'clip' ] );
const FILE_KEYS = [ 'article', 'suite', 'defaults', 'shots' ];
const DEFAULT_KEYS = [ 'scene', 'viewport', 'steps', 'capture' ];
const SHOT_KEYS = [
	'id',
	'preset',
	'alt',
	'caption',
	'kind',
	'scene',
	'viewport',
	'isolated',
	'steps',
	'script',
	'capture',
];
const CAPTURE_KEYS = [
	'target',
	'include',
	'pad',
	'fit',
	'frame',
	'annotate',
	'annotationScale',
	'mask',
];
const ANNOTATION_TYPES = [ 'outline', 'badge', 'arrow', 'dim' ];
const DIRECTIONS = [
	'top',
	'bottom',
	'left',
	'right',
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right',
];
// Verbs whose argument is a locator key (validated at load time).
const LOCATOR_VERBS = [ 'click', 'hover', 'scrollTo' ];

export class SpecError extends Error {
	constructor( file, message ) {
		super( `${ path.relative( process.cwd(), file ) }: ${ message }` );
		this.name = 'SpecError';
		this.file = file;
	}
}

/**
 * Walk the shots directory and load every spec.
 * @param {Object} config
 */
export function loadSpecs( config ) {
	const files = (
		config.specs
			? fs
					.globSync( config.specs, { cwd: config.root } )
					.map( ( f ) => path.resolve( config.root, f ) )
			: walk( config.shotsDir ).filter( ( f ) => /\.ya?ml$/.test( f ) )
	).sort();
	const specs = files.map( ( file ) => loadSpec( file, config ) );
	const seen = new Map();
	for ( const spec of specs ) {
		for ( const shot of spec.shots ) {
			const key = `${ spec.article }/${ shot.id }`;
			if ( seen.has( key ) ) {
				throw new SpecError(
					spec.file,
					`shot "${ key }" is also defined in ${ path.relative( specsBase( config ), seen.get( key ) ) }`
				);
			}
			seen.set( key, spec.file );
		}
	}
	return specs;
}

/**
 * Load and normalise one spec file.
 * @param {string} file
 * @param {Object} config
 */
export function loadSpec( file, config ) {
	let raw;
	try {
		raw = YAML.parse( fs.readFileSync( file, 'utf8' ) ) || {};
	} catch ( e ) {
		throw new SpecError( file, `invalid YAML: ${ e.message }` );
	}
	checkKeys( file, 'top level', raw, FILE_KEYS );
	if (
		! raw.article ||
		typeof raw.article !== 'string' ||
		! ID_RE.test( raw.article )
	) {
		throw new SpecError(
			file,
			'`article` is required and must be a lowercase slug'
		);
	}
	if ( ! Array.isArray( raw.shots ) || raw.shots.length === 0 ) {
		throw new SpecError( file, '`shots` must be a non-empty list' );
	}
	const defaults = raw.defaults || {};
	checkKeys( file, 'defaults', defaults, DEFAULT_KEYS );
	const defaultScene = defaults.scene || 'new-post';
	checkScene( file, 'defaults', defaultScene );
	const defaultSteps = normaliseSteps(
		file,
		'defaults',
		defaults.steps || [],
		'defaults'
	);

	const seen = new Set();
	const shots = raw.shots.map( ( shot, index ) => {
		const where = `shots[${ index }]${ shot?.id ? ` ("${ shot.id }")` : '' }`;
		if ( ! shot || typeof shot !== 'object' ) {
			throw new SpecError( file, `${ where } must be a mapping` );
		}
		let preset = null;
		if ( shot.preset !== undefined ) {
			if (
				typeof shot.preset !== 'string' ||
				! presetNames.includes( shot.preset )
			) {
				throw new SpecError(
					file,
					`${ where }: unknown preset "${ shot.preset }"${ suggest( shot.preset, presetNames ) }. Known: ${ presetNames.join( ', ' ) }`
				);
			}
			const paramNames = presetParamNames( shot.preset );
			checkKeys( file, where, shot, [ ...SHOT_KEYS, ...paramNames ] );
			const params = Object.fromEntries(
				paramNames.map( ( k ) => [ k, shot[ k ] ] )
			);
			try {
				preset = expandPreset( shot.preset, params );
			} catch ( e ) {
				throw new SpecError( file, `${ where }: ${ e.message }` );
			}
		} else {
			checkKeys( file, where, shot, SHOT_KEYS );
		}
		if ( ! shot.id || ! ID_RE.test( String( shot.id ) ) ) {
			throw new SpecError(
				file,
				`${ where }: \`id\` is required and must be a lowercase slug (a-z, 0-9, -)`
			);
		}
		if ( seen.has( shot.id ) ) {
			throw new SpecError( file, `duplicate shot id "${ shot.id }"` );
		}
		seen.add( shot.id );
		if ( typeof shot.alt !== 'string' || ! shot.alt.trim() ) {
			throw new SpecError(
				file,
				`${ where }: \`alt\` is required (the image's alt text)`
			);
		}
		const kind = shot.kind || 'image';
		if ( ! KINDS.has( kind ) ) {
			throw new SpecError(
				file,
				`${ where }: unknown kind "${ kind }" (image | clip)`
			);
		}
		// Default steps belong to the default scene: a shot that uses another scene does not inherit them.
		// A preset supplies its own starting state, so it inherits nothing from `defaults`.
		const scene = shot.scene || preset?.scene || defaultScene;
		checkScene( file, where, scene );
		const inherited =
			! preset && scene === defaultScene ? defaultSteps : [];
		const steps = [
			...inherited,
			...normaliseSteps( file, where, preset?.steps || [], 'preset' ),
			...normaliseSteps( file, where, shot.steps || [], 'shot' ),
		];
		const capture = normaliseCapture(
			file,
			where,
			{
				...( preset ? {} : defaults.capture || {} ),
				...( preset?.capture || {} ),
				...( shot.capture || {} ),
			},
			config
		);
		let script = null;
		if ( shot.script ) {
			script = path.resolve( path.dirname( file ), shot.script );
			if ( ! fs.existsSync( script ) ) {
				throw new SpecError(
					file,
					`${ where }: script not found: ${ script }`
				);
			}
		}
		const normalised = {
			id: shot.id,
			preset: shot.preset || null,
			kind,
			alt: shot.alt.trim(),
			caption:
				typeof shot.caption === 'string' ? shot.caption.trim() : null,
			scene,
			viewport: shot.viewport || defaults.viewport || 'desktop',
			isolated: Boolean( shot.isolated ),
			steps,
			script,
			capture,
		};
		normalised.specHash = hashShot( normalised );
		return normalised;
	} );
	return {
		file,
		relPath: path.relative( specsBase( config ), file ),
		article: raw.article,
		suite: raw.suite || 'default',
		shots,
	};
}

function specsBase( config ) {
	return config.specsBase || config.shotsDir;
}

function checkKeys( file, where, obj, allowed ) {
	if ( ! obj || typeof obj !== 'object' ) {
		return;
	}
	for ( const key of Object.keys( obj ) ) {
		if ( ! allowed.includes( key ) ) {
			throw new SpecError(
				file,
				`${ where }: unknown key "${ key }"${ suggest( key, allowed ) }. Allowed: ${ allowed.join( ', ' ) }`
			);
		}
	}
}

function checkScene( file, where, scene ) {
	if ( typeof scene !== 'string' ) {
		throw new SpecError( file, `${ where }: scene must be a string` );
	}
	const { name } = parseScene( scene );
	if ( ! sceneNames.includes( name ) ) {
		throw new SpecError(
			file,
			`${ where }: unknown scene "${ scene }"${ suggest( name, sceneNames ) }. Known: ${ sceneNames.join( ', ' ) }`
		);
	}
}

function normaliseSteps( file, where, steps, origin ) {
	if ( ! Array.isArray( steps ) ) {
		throw new SpecError( file, `${ where }: \`steps\` must be a list` );
	}
	return steps.map( ( step, i ) => {
		let verb;
		let arg;
		if ( typeof step === 'string' ) {
			verb = step;
		} else if ( step && typeof step === 'object' ) {
			const keys = Object.keys( step );
			if ( keys.length !== 1 ) {
				throw new SpecError(
					file,
					`${ where }: steps[${ i }] must have exactly one key (the verb), got ${ keys.join( ', ' ) }. Indent the verb's arguments under it.`
				);
			}
			verb = keys[ 0 ];
			arg = step[ verb ];
		} else {
			throw new SpecError(
				file,
				`${ where }: steps[${ i }] must be a string or a single-key mapping`
			);
		}
		if ( ! verbNames.includes( verb ) ) {
			throw new SpecError(
				file,
				`${ where }: steps[${ i }]: unknown step "${ verb }"${ suggest( verb, verbNames ) }. Known: ${ verbNames.join( ', ' ) }`
			);
		}
		if ( LOCATOR_VERBS.includes( verb ) ) {
			const problem = validateLocatorKey( arg );
			if ( problem ) {
				throw new SpecError(
					file,
					`${ where }: steps[${ i }] (${ verb }): ${ problem }`
				);
			}
		}
		return { verb, arg, origin, index: i };
	} );
}

function normaliseCapture( file, where, capture, config ) {
	checkKeys( file, `${ where } capture`, capture, CAPTURE_KEYS );
	const targetProblem = validateTargetName( capture.target );
	if ( targetProblem ) {
		throw new SpecError( file, `${ where } capture: ${ targetProblem }` );
	}
	const include = toList( capture.include );
	for ( const inc of include ) {
		const p = validateTargetName( inc );
		if ( p ) {
			throw new SpecError( file, `${ where } capture.include: ${ p }` );
		}
	}
	const annotate = toList( capture.annotate ).map( ( a, i ) => {
		if ( ! a || typeof a !== 'object' || Object.keys( a ).length !== 1 ) {
			throw new SpecError(
				file,
				`${ where } capture.annotate[${ i }] must be a single-key mapping like { outline: { button: Replace } }`
			);
		}
		const type = Object.keys( a )[ 0 ];
		if ( ! ANNOTATION_TYPES.includes( type ) ) {
			throw new SpecError(
				file,
				`${ where } capture.annotate[${ i }]: unknown annotation "${ type }" (${ ANNOTATION_TYPES.join( ' | ' ) })`
			);
		}
		const value = a[ type ];
		if ( value === 'self' ) {
			return { type, self: true };
		}
		if ( ! value || typeof value !== 'object' ) {
			throw new SpecError(
				file,
				`${ where } capture.annotate[${ i }] (${ type }): give it a locator ({ button: Replace }), a { target: name }, or "self"`
			);
		}
		const { target, label, position, from, ...locatorKey } = value;
		if ( from !== undefined && ! DIRECTIONS.includes( from ) ) {
			throw new SpecError(
				file,
				`${ where } capture.annotate[${ i }] (${ type }): from must be one of ${ DIRECTIONS.join( ' | ' ) }`
			);
		}
		if ( target !== undefined ) {
			const p = validateTargetName( target );
			if ( p ) {
				throw new SpecError(
					file,
					`${ where } capture.annotate[${ i }] (${ type }): ${ p }`
				);
			}
		} else {
			const p = validateLocatorKey( locatorKey );
			if ( p ) {
				throw new SpecError(
					file,
					`${ where } capture.annotate[${ i }] (${ type }): ${ p }`
				);
			}
		}
		if (
			position !== undefined &&
			! [
				'top-left',
				'top-right',
				'bottom-left',
				'bottom-right',
			].includes( position )
		) {
			throw new SpecError(
				file,
				`${ where } capture.annotate[${ i }]: position must be top-left | top-right | bottom-left | bottom-right`
			);
		}
		return { type, ...value };
	} );
	const mask = toList( capture.mask );
	for ( const m of mask ) {
		const p = validateLocatorKey( m );
		if ( p ) {
			throw new SpecError( file, `${ where } capture.mask: ${ p }` );
		}
	}
	const out = {
		target: capture.target || null,
		include,
		pad: capture.pad,
		frame: capture.frame || null,
		annotate,
		annotationScale: capture.annotationScale,
		mask,
		fit: capture.fit || null,
	};
	if (
		out.annotationScale !== undefined &&
		( typeof out.annotationScale !== 'number' || out.annotationScale <= 0 )
	) {
		throw new SpecError(
			file,
			`${ where } capture: annotationScale must be a positive number (1 = the base size)`
		);
	}
	if (
		out.pad !== undefined &&
		( typeof out.pad !== 'number' || out.pad < 0 )
	) {
		throw new SpecError(
			file,
			`${ where } capture: pad must be a number of CSS pixels`
		);
	}
	const frames = [ 'plain', ...frameNames( config?.style ) ];
	if ( out.frame && ! frames.includes( out.frame ) ) {
		throw new SpecError(
			file,
			`${ where } capture: unknown frame "${ out.frame }"${ suggest( out.frame, frames ) } (${ frames.join( ' | ' ) })`
		);
	}
	if ( out.fit && out.fit !== 'content' ) {
		throw new SpecError(
			file,
			`${ where } capture: unknown fit "${ out.fit }" (only "content")`
		);
	}
	return out;
}

function toList( value ) {
	if ( value === undefined || value === null ) {
		return [];
	}
	return Array.isArray( value ) ? value : [ value ];
}

function suggest( word, candidates ) {
	let best = null;
	let bestScore = 3;
	for ( const c of candidates ) {
		const d = levenshtein( String( word ).toLowerCase(), c.toLowerCase() );
		if ( d < bestScore ) {
			bestScore = d;
			best = c;
		}
	}
	return best ? ` (did you mean "${ best }"?)` : '';
}

function levenshtein( a, b ) {
	const m = a.length;
	const n = b.length;
	const dp = Array.from( { length: m + 1 }, ( _, i ) => [
		i,
		...Array( n ).fill( 0 ),
	] );
	for ( let j = 1; j <= n; j++ ) {
		dp[ 0 ][ j ] = j;
	}
	for ( let i = 1; i <= m; i++ ) {
		for ( let j = 1; j <= n; j++ ) {
			dp[ i ][ j ] = Math.min(
				dp[ i - 1 ][ j ] + 1,
				dp[ i ][ j - 1 ] + 1,
				dp[ i - 1 ][ j - 1 ] + ( a[ i - 1 ] === b[ j - 1 ] ? 0 : 1 )
			);
		}
	}
	return dp[ m ][ n ];
}

function hashShot( shot ) {
	const material = {
		preset: shot.preset,
		scene: shot.scene,
		viewport: shot.viewport,
		steps: shot.steps.map( ( { verb, arg } ) => ( { verb, arg } ) ),
		capture: shot.capture,
		script: shot.script ? fs.readFileSync( shot.script, 'utf8' ) : null,
	};
	return crypto
		.createHash( 'sha256' )
		.update( JSON.stringify( material ) )
		.digest( 'hex' )
		.slice( 0, 16 );
}

/**
 * Apply --article / --section / --suite / --shot filters.
 * @param {ReturnType<typeof loadSpecs>}                                            specs
 * @param {{article?:string[], section?:string[], suite?:string[], shot?:string[]}} filter
 */
export function filterSpecs( specs, filter = {} ) {
	let out = specs;
	if ( filter.article?.length ) {
		out = out.filter( ( s ) => filter.article.includes( s.article ) );
	}
	if ( filter.section?.length ) {
		const sections = filter.section.map( ( sec ) =>
			sec.replace( /^\.?\/?shots\//, '' ).replace( /\/$/, '' )
		);
		out = out.filter( ( s ) =>
			sections.some(
				( sec ) =>
					s.relPath === sec || s.relPath.startsWith( sec + '/' )
			)
		);
	}
	if ( filter.suite?.length ) {
		out = out.filter( ( s ) => filter.suite.includes( s.suite ) );
	}
	if ( filter.shot?.length ) {
		out = out
			.map( ( s ) => ( {
				...s,
				shots: s.shots.filter( ( sh ) =>
					filter.shot.includes( sh.id )
				),
			} ) )
			.filter( ( s ) => s.shots.length );
	}
	return out;
}
