/**
 * A session is a booted environment: WordPress Playground plus a Chromium context logged into it, with the
 * helpers the scenes, steps and capture need (`ctx`). The runner opens one per suite and closes it at the end;
 * a long-lived caller such as the MCP server keeps one open across calls so a screenshot costs seconds instead
 * of a Playground boot.
 */
import path from 'node:path';
import { startPlayground } from './env/playground.js';
import { launchBrowser } from './browser.js';
import { createSite } from './site.js';
import { blueprintForSuite } from './config.js';
import { hashFile } from './files.js';

/**
 * Boot Playground and the browser for a suite.
 * @param {Object}             options
 * @param {Object}             options.config   a loaded config
 * @param {string}             [options.suite]  blueprint suite (default "default")
 * @param {boolean}            [options.headed] show the browser
 * @param {(msg:string)=>void} [options.log]
 * @return {Promise<Session>} the open session
 */
export async function openSession( options ) {
	const session = new Session( options );
	await session.boot();
	return session;
}

export class Session {
	constructor( {
		config,
		suite = 'default',
		headed = false,
		log = () => {},
	} ) {
		this.config = config;
		this.suite = suite;
		this.headed = headed;
		this.log = log;
		this.blueprint = blueprintForSuite( config, suite );
		this.blueprintHash = hashFile( this.blueprint );
		this.env = null;
		this.browser = null;
		this.ctx = null;
	}

	/** True while Playground and the browser are both up. */
	get alive() {
		return Boolean(
			this.env?.alive?.() !== false &&
			this.env &&
			this.browser &&
			this.browser.browser.isConnected()
		);
	}

	/** Boot (or reboot) the environment. */
	async boot() {
		await this.close();
		const { config, log } = this;
		this.env = await startPlayground( {
			blueprint: this.blueprint,
			host: config.host,
			port: config.port,
			wp: config.wordpress.version,
			php: config.wordpress.php,
			logFile: path.join(
				config.workDir,
				`playground-${ this.suite }.log`
			),
			log,
		} );
		this.browser = await launchBrowser( {
			baseURL: this.env.baseURL,
			style: config.style,
			user: config.user,
			headed: this.headed,
		} );
		// First request: Playground's login step hands the browser its auth cookie, which the REST helpers
		// (template lookups, cleanup) reuse. Without this, a run whose first shot uses {{media.*}} has no cookie.
		await this.browser.page.goto( '/wp-admin/index.php' );
		const site = createSite( {
			baseURL: this.env.baseURL,
			context: this.browser.context,
		} );
		this.ctx = {
			...this.browser,
			site,
			style: config.style,
			config,
			log,
			baseURL: this.env.baseURL,
			versions: this.env.versions,
		};
		return this;
	}

	/** Boot only if something died. */
	async ensure() {
		if ( ! this.alive ) {
			await this.boot();
		}
		return this;
	}

	/** Fresh WordPress: same as boot, named for what callers mean. */
	async reboot() {
		return this.boot();
	}

	/** Stop the browser and Playground. Safe to call twice. */
	async close() {
		const { browser, env } = this;
		this.browser = null;
		this.env = null;
		this.ctx = null;
		if ( browser ) {
			await browser.close().catch( () => {} );
		}
		if ( env ) {
			await env.stop().catch( () => {} );
		}
	}
}
