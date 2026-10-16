// House style tokens. Everything visual that a project might want to change lives here and can be
// overridden from `shots.config.js` under `style`. See ARCHITECTURE.md §4.5 of the proposal.

export const defaultStyle = {
	viewports: {
		desktop: { width: 1440, height: 900 },
		narrow: { width: 1024, height: 768 },
		mobile: { width: 390, height: 844 },
	},
	deviceScaleFactor: 2,
	colorScheme: 'light',
	locale: 'en-US',
	timezoneId: 'UTC',
	// Optional browser start time (ISO string). Time keeps flowing from it, so debounced UI still works.
	// Default null: real time, because Playground's server clock is real time and a browser clock in the
	// past turns "Publish" into "Schedule". Mask or freeze relative timestamps per shot instead.
	clock: null,
	// Editor scenes: open in fullscreen mode (no wp-admin menu) and hide the admin bar.
	fullscreenMode: true,
	hideAdminBar: true,
	// Default padding (CSS px) around an element crop.
	pad: 16,
	// Default frame: none | card | auto | wide | standard | portrait | banner (see `frames` and `stage`).
	frame: 'none',
	// Canonical aspect ratios (width / height) for documentation images. `auto` picks the one nearest to the
	// content's own ratio. The content is never scaled; the stage grows around it to reach the ratio.
	frames: {
		wide: 16 / 9, // full editor, site editor, admin screens
		standard: 4 / 3, // modals, popovers, dialogs, blocks on the canvas
		portrait: 3 / 4, // the inspector and other sidebars
		banner: 3 / 1, // toolbars and single controls
	},
	// The stage behind a framed capture. `background` is a CSS color or a { gradient: [from, to], angle } object.
	stage: {
		background: { gradient: [ '#f0f2fb', '#e3e7f7' ], angle: 160 },
		margin: 40, // minimum space between the capture and the stage edge (CSS px)
		radius: 8,
		shadow: { blur: 28, offsetY: 10, color: 'rgba(31, 36, 61, 0.18)' },
	},
	// Accent: WordPress blue. The editor's own selection outline is the same blue, so annotations carry a white
	// halo on both sides of the stroke to stay legible on top of it.
	accent: '#3858e9',
	outline: {
		color: '#3858e9',
		width: 3,
		radius: 4,
		gap: 4,
		halo: { color: '#ffffff', width: 2 },
	},
	badge: {
		size: 24,
		background: '#3858e9',
		color: '#ffffff',
		font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		position: 'top-left',
		halo: { color: '#ffffff', width: 2 },
	},
	arrow: {
		color: '#3858e9',
		width: 3,
		length: 56, // CSS px from the tail to the target's edge
		head: 12, // arrowhead size
		gap: 6, // space between the arrowhead tip and the target
		halo: { color: '#ffffff', width: 2 },
		from: 'top-right', // default direction the arrow comes from
	},
	dim: { color: 'rgba(255, 255, 255, 0.45)' },
	// Legacy content-sized card (frame: card). Kept for projects that used it; `stage` is the new default look.
	card: {
		background: '#f6f7f7',
		margin: 36,
		radius: 8,
		shadow: { blur: 24, offsetY: 8, color: 'rgba(0, 0, 0, 0.14)' },
	},
	maskColor: '#dcdcde',
	// Output encoding. WebP is encoded losslessly when the result fits `maxBytes` (UI crops: tens of KB),
	// and falls back to lossy `quality` above it (photo-heavy full-editor shots, where lossless WebP is even
	// larger than PNG). The manifest records which encoding each image got. `maxBytes: null` = always lossless.
	format: 'webp',
	webp: { lossless: true, effort: 6, maxBytes: 300 * 1024, quality: 90 },
	png: { compressionLevel: 9 },
	// Wait after the page settles before capturing, to let popovers position (ms).
	settleDelay: 250,
};

/**
 * Deep-merge style overrides onto the defaults (one level of nesting is enough for these tokens).
 * @param {Object} overrides
 */
export function mergeStyle( overrides = {} ) {
	const out = structuredClone( defaultStyle );
	for ( const [ key, value ] of Object.entries( overrides ) ) {
		if (
			value &&
			typeof value === 'object' &&
			! Array.isArray( value ) &&
			typeof out[ key ] === 'object'
		) {
			out[ key ] = { ...out[ key ], ...value };
		} else {
			out[ key ] = value;
		}
	}
	return out;
}

/**
 * The frame names a spec may use: the canonical ratios plus none, card and auto.
 * @param {Object} style
 * @return {string[]} frame names
 */
export function frameNames( style = defaultStyle ) {
	return [ 'none', 'card', 'auto', ...Object.keys( style.frames ) ];
}

/**
 * Pick the canonical frame whose ratio is nearest to a content size.
 * @param {Object} style
 * @param {number} width
 * @param {number} height
 * @return {string} a key of `style.frames`
 */
export function nearestFrame( style, width, height ) {
	const ratio = width / Math.max( 1, height );
	let best = null;
	let bestDistance = Infinity;
	for ( const [ name, value ] of Object.entries( style.frames ) ) {
		// Compare in log space so 2:1 vs 1:1 and 1:1 vs 1:2 are equally far apart.
		const distance = Math.abs( Math.log( ratio ) - Math.log( value ) );
		if ( distance < bestDistance ) {
			bestDistance = distance;
			best = name;
		}
	}
	return best;
}

/**
 * Resolve a viewport name or object to {width, height}.
 * @param {Object}                              style
 * @param {string|{width:number,height:number}} viewport
 */
export function resolveViewport( style, viewport = 'desktop' ) {
	if ( typeof viewport === 'object' && viewport.width && viewport.height ) {
		return { width: viewport.width, height: viewport.height };
	}
	const found = style.viewports[ viewport ];
	if ( ! found ) {
		throw new Error(
			`Unknown viewport "${ viewport }". Known: ${ Object.keys( style.viewports ).join( ', ' ) }`
		);
	}
	return found;
}
