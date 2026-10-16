/**
 * Presets: a subject someone asks for in plain words ("the Image block on the canvas", "its settings panel",
 * "the site editor") expanded into the scene, steps and capture that the house style has settled on, so a
 * spec or an agent states the subject and the engine supplies the judgment.
 *
 * Each preset declares its parameters (validated at spec load) and an `expand( params )` returning the shot
 * fields it fills in. Anything the shot sets explicitly wins over the preset; shot steps run after preset steps.
 * A tight preset may name an `annotationScope`: the region its annotations look in when they do not say
 * ("Options" exists in the block toolbar and in the top bar).
 */

const BLOCK_PARAM = {
	required: true,
	description:
		'Block name, for example core/image. The demo site is expected to hold a showcase post named block-<name> (block-image) with that block in it; set post to another slug, or to "new" to insert the block into a fresh post instead.',
};
const POST_PARAM = {
	description:
		'Slug of the post to open (default: block-<name> from the block param). "new" starts an empty post and inserts the block (a Paragraph gets a sample sentence: an empty one shows no block toolbar).',
};

export const presets = {
	'block-canvas': {
		description:
			'A block as it appears on the editor canvas, selected, with its toolbar.',
		params: { block: BLOCK_PARAM, post: POST_PARAM },
		expand: ( { block, post } ) => ( {
			scene: sceneFor( block, post ),
			steps: stepsFor( block, post ),
			capture: {
				target: 'selected-block',
				include: [ 'block-toolbar' ],
				// Tight enough that neighbouring blocks do not show as cut-off lines of text.
				pad: 20,
				frame: 'auto',
			},
		} ),
	},
	'block-toolbar': {
		description: 'The toolbar of a selected block.',
		params: { block: BLOCK_PARAM, post: POST_PARAM },
		annotationScope: 'block-toolbar',
		expand: ( { block, post } ) => ( {
			scene: sceneFor( block, post ),
			steps: stepsFor( block, post ),
			// Tight: a toolbar sits right under the previous block, and a wide pad drags that text in half-cut.
			capture: { target: 'block-toolbar', pad: 6, frame: 'banner' },
		} ),
	},
	'block-settings': {
		description:
			'The block inspector (sidebar) for a selected block, on one of its tabs, optionally with a panel expanded.',
		annotationScope: 'inspector',
		params: {
			block: BLOCK_PARAM,
			post: POST_PARAM,
			tab: {
				default: 'settings',
				options: [ 'content', 'settings', 'styles' ],
				description: 'Inspector tab to open.',
			},
			panel: {
				description:
					'Name of a collapsed panel to expand, for example "Dimensions".',
			},
		},
		expand: ( { block, post, tab, panel } ) => ( {
			scene: sceneFor( block, post ),
			steps: [
				...stepsFor( block, post ),
				{ openInspector: tab },
				...( panel ? [ { openPanel: panel } ] : [] ),
			],
			capture: {
				target: 'inspector',
				fit: 'content',
				pad: 0,
				frame: 'portrait',
			},
		} ),
	},
	'site-editor': {
		description: 'The site editor, on its home view or a named view.',
		params: {
			view: {
				description:
					'Site editor view: templates, parts, patterns, navigation, pages, styles, template:<theme>//<slug>, part:<theme>//<slug>. Omit for the home view.',
			},
		},
		expand: ( { view } ) => ( {
			scene: view ? `site-editor:${ view }` : 'site-editor',
			steps: [],
			capture: { target: 'editor', frame: 'wide' },
		} ),
	},
	'post-editor': {
		description: 'The whole post editor with a post open.',
		params: {
			post: {
				description:
					'Slug of the post to open. Omit for a new, empty post.',
			},
		},
		expand: ( { post } ) => ( {
			scene: post ? `post:${ post }` : 'new-post',
			steps: [],
			capture: { target: 'editor', frame: 'wide' },
		} ),
	},
	'admin-screen': {
		description: 'A wp-admin screen, full width.',
		params: {
			screen: {
				required: true,
				description:
					'Admin path, for example plugins.php or options-general.php.',
			},
		},
		expand: ( { screen } ) => ( {
			scene: `admin:${ screen }`,
			steps: [],
			capture: { target: 'admin-screen', frame: 'wide' },
		} ),
	},
	'front-end': {
		description: 'The public site as a visitor sees it.',
		params: {
			path: {
				description:
					'Path to open, for example /about/. Omit for the home page.',
			},
		},
		expand: ( { path } ) => ( {
			scene: path ? `front:${ path }` : 'front',
			steps: [],
			capture: { target: 'front', frame: 'wide' },
		} ),
	},
};

export const presetNames = Object.keys( presets );

/**
 * Validate preset parameters and return the expanded shot fields.
 * @param {string} name
 * @param {Object} params
 * @return {{scene: string, steps: Object[], capture: Object}} fields for the shot
 */
export function expandPreset( name, params ) {
	const preset = presets[ name ];
	if ( ! preset ) {
		throw new Error( `unknown preset "${ name }"` );
	}
	const resolved = {};
	for ( const [ key, def ] of Object.entries( preset.params ) ) {
		const value = params[ key ];
		if ( value === undefined || value === null ) {
			if ( def.required ) {
				throw new Error(
					`preset ${ name } needs \`${ key }\` (${ def.description })`
				);
			}
			resolved[ key ] = def.default ?? null;
			continue;
		}
		if ( typeof value !== 'string' ) {
			throw new Error(
				`preset ${ name }: \`${ key }\` must be a string`
			);
		}
		if ( def.options && ! def.options.includes( value ) ) {
			throw new Error(
				`preset ${ name }: \`${ key }\` must be one of ${ def.options.join( ' | ' ) }`
			);
		}
		resolved[ key ] = value;
	}
	return preset.expand( resolved );
}

/**
 * The names of the parameters a preset accepts (for key validation).
 * @param {string} name
 * @return {string[]} parameter names
 */
export function presetParamNames( name ) {
	return Object.keys( presets[ name ]?.params || {} );
}

function showcaseSlug( block ) {
	return `block-${ block.replace( /^core\//, '' ).replace( /\//g, '-' ) }`;
}

function sceneFor( block, post ) {
	if ( post === 'new' ) {
		return 'new-post';
	}
	return `post:${ post || showcaseSlug( block ) }`;
}

// Content a block gets when a preset inserts it into a new post. An empty Paragraph is the editor's "empty default
// block": it shows the side inserter instead of a block toolbar, so a toolbar or Options-menu shot needs text in it.
const NEW_BLOCK_ATTRIBUTES = {
	'core/paragraph': {
		content:
			'The harbour path is at its best an hour after sunrise, when the light is low and the tide is out.',
	},
};

function stepsFor( block, post ) {
	if ( post !== 'new' ) {
		return [ { selectBlock: block } ];
	}
	const attributes = NEW_BLOCK_ATTRIBUTES[ block ];
	return [
		{ insertBlock: attributes ? { name: block, attributes } : block },
	];
}
