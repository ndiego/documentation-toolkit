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
	// Default framing preset: plain | card
	frame: 'plain',
	outline: { color: '#3858e9', width: 3, radius: 4, gap: 4 },
	badge: {
		size: 24,
		background: '#3858e9',
		color: '#ffffff',
		font: '600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
		position: 'top-left',
	},
	dim: { color: 'rgba(255, 255, 255, 0.45)' },
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
