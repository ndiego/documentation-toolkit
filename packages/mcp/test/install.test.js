import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	resolveBinary,
	npxCliFor,
	launchEnv,
	chooseNode,
	launchSpec,
	registerDesktop,
	runInstall,
	runUninstall,
	desktopConfigPath,
} from '../src/install.js';

describe( 'install', () => {
	it( 'launches the checkout directly with absolute paths', () => {
		const spec = launchSpec( 'path' );
		assert.equal( spec.command, process.execPath );
		assert.ok( path.isAbsolute( spec.args[ 0 ] ) );
		assert.ok(
			spec.args[ 0 ].endsWith( path.join( 'mcp', 'src', 'cli.js' ) )
		);
		assert.equal(
			spec.env.PATH.split( path.delimiter )[ 0 ],
			path.dirname( process.execPath )
		);
	} );

	it( 'puts the chosen Node first on the launch PATH, once', () => {
		const d = path.delimiter;
		const base = [ '/usr/bin', '/x/bin', '', '/bin' ].join( d );
		assert.equal(
			launchEnv( '/x/bin/node', base ).PATH,
			[ '/x/bin', '/usr/bin', '/bin' ].join( d )
		);
	} );

	it( 'launches through npx with a pinned version when asked', () => {
		const spec = launchSpec( 'npx' );
		assert.equal( spec.command, process.execPath );
		assert.ok(
			spec.args[ 0 ].endsWith( path.join( 'npm', 'bin', 'npx-cli.js' ) )
		);
		assert.equal( spec.args[ 1 ], '-y' );
		assert.match( spec.args[ 2 ], /^@wp-docs-toolkit\/mcp@\d+\.\d+\.\d+$/ );
	} );

	it( 'merges into an existing desktop config with a backup and removes cleanly', () => {
		const dir = fs.mkdtempSync(
			path.join( os.tmpdir(), 'wp-docs-install-' )
		);
		const file = path.join( dir, 'claude_desktop_config.json' );
		fs.writeFileSync(
			file,
			JSON.stringify( {
				preferences: { keep: true },
				mcpServers: { other: { command: 'x' } },
			} )
		);
		const lines = [];
		runInstall( {
			config: file,
			claudeCode: false,
			via: 'path',
			log: ( m ) => lines.push( m ),
		} );
		const data = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		assert.deepEqual( data.preferences, { keep: true } );
		assert.deepEqual( data.mcpServers.other, { command: 'x' } );
		assert.equal(
			data.mcpServers[ 'wp-docs-toolkit' ].command,
			process.execPath
		);
		assert.ok(
			data.mcpServers[ 'wp-docs-toolkit' ].env.PATH.startsWith(
				path.dirname( process.execPath ) + path.delimiter
			)
		);
		assert.ok(
			fs.readdirSync( dir ).some( ( f ) => f.includes( '.bak-' ) )
		);
		assert.match( lines.join( '\n' ), /Registered in Claude Desktop/ );
		runUninstall( { config: file, log: () => {} } );
		const after = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		assert.equal( after.mcpServers[ 'wp-docs-toolkit' ], undefined );
		assert.deepEqual( after.mcpServers.other, { command: 'x' } );
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'creates the config when none exists', () => {
		const dir = fs.mkdtempSync(
			path.join( os.tmpdir(), 'wp-docs-install-' )
		);
		const file = path.join( dir, 'nested', 'claude_desktop_config.json' );
		const backup = registerDesktop( file, {
			command: 'node',
			args: [ 'x' ],
		} );
		assert.equal( backup, '' );
		assert.deepEqual(
			JSON.parse( fs.readFileSync( file, 'utf8' ) ).mcpServers[
				'wp-docs-toolkit'
			],
			{
				command: 'node',
				args: [ 'x' ],
			}
		);
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'knows the platform config path', () => {
		assert.ok(
			desktopConfigPath().endsWith( 'claude_desktop_config.json' )
		);
	} );

	it( 'finds the npx script beside a Node binary and falls back to the running npm', () => {
		assert.ok(
			npxCliFor( process.execPath ).endsWith(
				path.join( 'npm', 'bin', 'npx-cli.js' )
			)
		);
		assert.ok(
			npxCliFor( '/nowhere/bin/node' ).endsWith(
				path.join( 'npm', 'bin', 'npx-cli.js' )
			)
		);
	} );

	it( 'chooses the running Node when it is supported and registers it in the launch', () => {
		const choice = chooseNode();
		assert.equal( choice.switched, false );
		assert.equal( choice.bin, process.execPath );
		const spec = launchSpec( 'npx', choice.bin );
		assert.equal( spec.command, process.execPath );
	} );

	it( 'resolves a --node value to an absolute existing path or null', () => {
		assert.equal( resolveBinary( process.execPath ), process.execPath );
		assert.equal( resolveBinary( '/nowhere/node' ), null );
		const byName = resolveBinary( 'node' );
		assert.ok( byName === null || path.isAbsolute( byName ) );
	} );
} );
