/**
 * A stand-in for Playwright's Page/Frame/Locator chain, for tests of the pure dispatch logic in
 * targets.js and locators.js. Every call appends to a readable path, e.g.
 * `page > role(button,{"name":"Replace","exact":true}) > first`, and `count()` is answered by a
 * function of that path so a test can decide where a match "exists".
 */
export class FakeLocator {
	constructor( chain, counts = () => 0, names = () => '' ) {
		this.chain = chain;
		this.counts = counts;
		this.names = names;
	}

	next( step ) {
		return new FakeLocator(
			[ ...this.chain, step ],
			this.counts,
			this.names
		);
	}

	get path() {
		return this.chain.join( ' > ' );
	}

	locator( selector ) {
		return this.next( `locator(${ selector })` );
	}

	getByRole( role, opts ) {
		return this.next(
			`role(${ role }${ opts ? `,${ JSON.stringify( opts ) }` : '' })`
		);
	}

	getByLabel( label, opts ) {
		return this.next( `label(${ label },${ JSON.stringify( opts ) })` );
	}

	getByPlaceholder( text, opts ) {
		return this.next(
			`placeholder(${ text },${ JSON.stringify( opts ) })`
		);
	}

	getByText( text, opts ) {
		return this.next( `text(${ text },${ JSON.stringify( opts ) })` );
	}

	filter( { has } ) {
		return this.next( `filter(has ${ has.path })` );
	}

	first() {
		return this.next( 'first' );
	}

	last() {
		return this.next( 'last' );
	}

	nth( n ) {
		return this.next( `nth(${ n })` );
	}

	async count() {
		return this.counts( this.path );
	}

	async isVisible() {
		return true;
	}

	async evaluate() {
		return this.names( this.path );
	}
}

/**
 * @param {(path:string)=>number} counts Number of matches for a locator path (may throw).
 * @param {(path:string)=>string} names  Accessible name reported by evaluate() for a locator path.
 */
export function fakeContext( counts, names ) {
	return {
		page: new FakeLocator( [ 'page' ], counts, names ),
		editor: { canvas: new FakeLocator( [ 'canvas' ], counts, names ) },
	};
}
