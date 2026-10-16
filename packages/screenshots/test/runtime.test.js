import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	isSupportedNode,
	unsupportedNodeMessage,
	findSupportedNode,
	ensureSupportedNode,
} from '../src/runtime.js';

describe( 'node support', () => {
	it( 'accepts 22.19 through 25 and rejects older and 26+', () => {
		assert.equal( isSupportedNode( '22.19.0' ), true );
		assert.equal( isSupportedNode( 'v24.21.0' ), true );
		assert.equal( isSupportedNode( '25.9.1' ), true );
		assert.equal( isSupportedNode( '22.18.9' ), false );
		assert.equal( isSupportedNode( '20.0.0' ), false );
		assert.equal( isSupportedNode( '26.4.0' ), false );
	} );

	it( 'explains an unsupported version and stays quiet on a supported one', () => {
		assert.match(
			unsupportedNodeMessage( '26.4.0' ),
			/Node 26\.4\.0 is not supported/
		);
		assert.match( unsupportedNodeMessage( '26.4.0' ), /nvm install 24/ );
		assert.equal( unsupportedNodeMessage( '24.21.0' ), null );
		assert.doesNotThrow( () => ensureSupportedNode() );
	} );

	it( 'keeps the current Node when supported, else picks the newest supported candidate', () => {
		const versions = {
			'/a/node': '22.20.0',
			'/b/node': '24.3.0',
			'/c/node': '26.1.0',
			'/d/node': null,
		};
		const versionOf = ( bin ) => versions[ bin ];
		const candidates = Object.keys( versions );
		assert.deepEqual(
			findSupportedNode( {
				current: '24.21.0',
				currentBin: '/me/node',
				candidates,
				versionOf,
			} ),
			{ bin: '/me/node', version: '24.21.0', switched: false }
		);
		assert.deepEqual(
			findSupportedNode( {
				current: '26.4.0',
				currentBin: '/me/node',
				candidates,
				versionOf,
			} ),
			{ bin: '/b/node', version: '24.3.0', switched: true }
		);
		assert.equal(
			findSupportedNode( {
				current: '26.4.0',
				currentBin: '/me/node',
				candidates: [ '/c/node' ],
				versionOf,
			} ),
			null
		);
	} );
} );
