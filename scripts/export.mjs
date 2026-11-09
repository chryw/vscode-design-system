/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Export tooling for the no-build canvas. */
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { TopicStore } from '../runtime/store.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { curateFixtures } from '../model/components.mjs';
import { DocumentError, resolveDocumentReference } from '../model/documents.mjs';
import { defaultView } from '../runtime/view-state.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';

const [output, option, selectedRoot, ...extra] = process.argv.slice(2);
if (!output || extra.length || option !== undefined && (option !== '--root' || !selectedRoot)) {
	throw new Error('Usage: node scripts/export.mjs <output.html> [--root <checkout>]');
}
const root = path.resolve(selectedRoot ?? workspaceRoot);
const assets = fileURLToPath(new URL('../view/', import.meta.url));
const destination = path.resolve(output);
const scratch = await mkdtemp(path.resolve('.design-system-export-'));
const require = createRequire(path.join(root, 'build/rspack/package.json'));
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
const { rspack } = require('@rspack/core');
const base = (await import(pathToFileURL(path.join(root, 'build/rspack/rspack.serve-out.config.mts')).href)).default;
const encode = value => gzipSync(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const safeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const script = value => `<script>${value.replaceAll('</script', '<\\/script')}</script>`;
const store = new TopicStore(root);
const repository = readRepository(root);
const { catalog, controls, motionControls } = repository;
const fixtureControls = [...controls.filter(item => !item.hidden || item.id === 'icon-label'), ...motionControls];
let browser;
try {
	const selected = catalog.filter(item => !item.hidden);
	const topics = {};
	for (const entry of selected) {
		const view = defaultView(entry.id, repository);
		topics[entry.id] = (await store.read(entry.id, view)).data;
		console.log(`Captured ${entry.id}`);
	}
	const provenance = topics.principles.provenance;
	const snapshot = { createdAt: new Date().toISOString(), commit: provenance.commit, modified: provenance.modified, catalog: selected, topics, repository: repository.projection };
	snapshot.documents = store.documents.snapshot();
	snapshot.documentImages = Object.create(null);
	snapshot.documentImageProblems = Object.create(null);
	let documentImageBytes = 0;
	for (const document of snapshot.documents.documents) {
		for (const reference of document.references.filter(reference => reference.image)) {
			const key = JSON.stringify([document.id, reference.target]);
			try {
				const resolved = resolveDocumentReference(document.id, reference.target);
				if (!['source', 'document'].includes(resolved.kind)) { continue; }
				const resource = store.documents.documentResource(document, reference.target);
				documentImageBytes += resource.content.length;
				if (documentImageBytes > 8 * 1024 * 1024) { throw new Error('Document images exceed the portable snapshot size limit'); }
				snapshot.documentImages[key] = `data:${resource.type};base64,${resource.content.toString('base64')}`;
			} catch (error) {
				if (error.code !== 'ENOENT' && !(error instanceof DocumentError)) { throw error; }
				snapshot.documentImageProblems[key] = error.message;
			}
		}
	}
	// Absolute machine paths are not part of the shared reference.
	for (const topic of Object.values(topics)) {
		topic.provenance = { commit: provenance.commit, modified: provenance.modified, kind: 'Portable snapshot', deployment: 'Frozen design-system working snapshot' };
	}
	const fixtureFiles = [...new Set(fixtureControls.filter(item => item.groups.length).map(item => item.file))];
	const fixtureEntry = path.join(scratch, 'fixtures.mjs');
	await writeFile(fixtureEntry, `
		import { ExplorerApp } from ${JSON.stringify(path.join(root, 'node_modules/@vscode/component-explorer/dist/viewer.js'))};
		${fixtureFiles.map((file, index) => `import * as fixture${index} from ${JSON.stringify(path.join(root, file))};`).join('\n')}
		new ExplorerApp(document.getElementById('root'), { loadFixtures: async () => ({
			${fixtureFiles.map((file, index) => `${JSON.stringify(`./${file}`)}: fixture${index}`).join(',\n')}
		}) });
	`);
	async function bundle(name, entry, portable = false) {
		const config = {
			...base, mode: 'production', entry: { [name]: entry }, devtool: false, devServer: undefined,
			output: { path: path.join(scratch, name), filename: 'app.js', publicPath: '', clean: true },
			plugins: [new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
			optimization: { minimize: true, splitChunks: false, moduleIds: 'deterministic' },
			module: { rules: [
				...base.module.rules.map(rule => rule.test?.test('.ttf') ? { test: /\.(ttf|woff2?|svg|png)$/, type: 'asset/inline' } : rule),
				{ test: /(?:fileIconThemeData|fixtureResourceLoader|amdX)\.ts$/, use: [fileURLToPath(new URL('./portable-loader.cjs', import.meta.url))] },
				...(portable ? [{ test: /(?:reference|ui|components|motion)\.mjs$/, include: assets, use: [{
					loader: fileURLToPath(new URL('./portable-loader.cjs', import.meta.url)),
					options: { renderers: [...new Set(catalog.map(entry => entry.renderer))] },
				}] }] : []),
			] },
		};
		await new Promise((resolve, reject) => {
			const compiler = rspack(config);
			compiler.run((error, stats) => {
				compiler.close(closeError => {
					if (error || closeError) { reject(error ?? closeError); }
					else if (stats.hasErrors()) { reject(new Error(stats.toString({ all: false, errors: true }))); }
					else { resolve(); }
				});
			});
		});
		const files = await readdir(config.output.path);
		if (files.some(file => !['app.js', 'app.css'].includes(file))) { throw new Error(`Unexpected external bundle assets: ${files.join(', ')}`); }
		return { js: await readFile(path.join(config.output.path, 'app.js'), 'utf8'),
			css: files.includes('app.css') ? await readFile(path.join(config.output.path, 'app.css'), 'utf8') : '' };
	}
	const fixture = await bundle('fixtures', fixtureEntry);
	const syntaxSources = await readFile(path.join(root, 'src/vs/workbench/test/browser/componentFixtures/fixtureSyntaxHighlighting.ts'), 'utf8');
	const resourcePaths = ['node_modules/vscode-oniguruma/release/onig.wasm', ...[...syntaxSources.matchAll(/path: '(extensions\/[^']+)'/g)].map(match => match[1])];
	const resources = {};
	for (const file of resourcePaths) {
		const content = await readFile(path.join(root, file));
		resources[file] = `data:${file.endsWith('.wasm') ? 'application/wasm' : 'text/plain'};base64,${content.toString('base64')}`;
	}
	const iconThemes = {};
	for (const relative of ['extensions/theme-seti/icons/vs-seti-icon-theme.json', 'extensions/theme-defaults/fileicons/vs_minimal-icon-theme.json']) {
		const text = await readFile(path.join(root, relative), 'utf8');
		const fontFiles = [...text.matchAll(/"(?:path|iconPath)"\s*:\s*"([^"]+\.(?:woff2?|ttf|svg))"/g)];
		let embedded = text;
		for (const match of fontFiles) {
			const data = await readFile(path.resolve(root, path.dirname(relative), match[1]));
			embedded = embedded.replaceAll(match[1], `data:${match[1].endsWith('.svg') ? 'image/svg+xml' : 'font/woff'};base64,${data.toString('base64')}`);
		}
		iconThemes[relative] = embedded;
	}
	const fixtureBootstrap = `
		globalThis.portableFixtureResources = ${safeJSON(resources)};
		const nativeFetch = globalThis.fetch;
		const iconThemes = ${safeJSON(iconThemes)};
		globalThis.fetch = (input, options) => {
			const url = new URL(typeof input === 'string' ? input : input.url, document.baseURI);
			const key = Object.keys(iconThemes).find(key => url.pathname.endsWith('/' + key));
			return key ? Promise.resolve(new Response(iconThemes[key], { headers: { 'Content-Type': 'application/json' } })) : nativeFetch(input, options);
		};
	`;
	const fixtureHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html{color-scheme:dark}html,body,#root{margin:0;width:100%;min-height:100%}${fixture.css}</style></head><body><div id="root"></div>${script(fixtureBootstrap)}${script(fixture.js)}</body></html>`;
	const fixturePath = path.join(scratch, 'fixture.html');
	await writeFile(fixturePath, fixtureHTML);
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.goto(`${pathToFileURL(fixturePath).href}?mode=headless`);
	await page.waitForFunction(() => window.__componentExplorer__);
	const fixtures = await page.evaluate(() => window.__componentExplorer__.listFixtures());
	snapshot.fixtures = { controls: curateFixtures(fixtures, fixtureControls) };
	for (const control of snapshot.fixtures.controls) {
		if (control.groups.length && !control.variants.length) { throw new Error(`No exported fixture variants for ${control.id}`); }
	}
	await browser.close();
	browser = undefined;
	const portable = await bundle('reference', path.join(assets, 'portable.mjs'), true);
	let css = (await Promise.all(['canvas.css', 'shell.css', 'book-navigation.css', 'motion.css'].map(file => readFile(path.join(assets, file), 'utf8')))).join('\n');
	if (!css.includes('color-scheme: light dark;')) { throw new Error('Portable export needs the reference color-scheme declaration'); }
	css = `html { color-scheme: dark; }\n${css.replace('color-scheme: light dark;', 'color-scheme: inherit;')}`;
	const font = await readFile(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.ttf'));
	css = css.replace('/codicon.ttf', `data:font/ttf;base64,${font.toString('base64')}`);
	for (const content of [JSON.stringify(snapshot), fixtureHTML, portable.js, css]) {
		if (content.includes(root) || content.includes(scratch)) { throw new Error('Export contains a machine-local source path'); }
	}
	const payload = { snapshot: encode(snapshot), fixture: encode(fixtureHTML), app: encode(portable.js) };
	const bootstrap = `
		const payload = JSON.parse(document.getElementById('snapshot-payload').textContent);
		async function unpack(value) {
			const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
			return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
		}
		async function start() {
			const query = new URLSearchParams(location.search);
			if (['embedded', 'headless'].includes(query.get('mode'))) {
				const html = await unpack(payload.fixture);
				document.open(); document.write(html); document.close();
				return;
			}
			globalThis.designSnapshot = JSON.parse(await unpack(payload.snapshot));
			globalThis.portableFixtureURL = () => {
				const url = new URL(location.href); url.search = ''; url.hash = ''; return url.href;
			};
			const app = document.createElement('script');
			app.textContent = await unpack(payload.app);
			document.body.append(app);
		}
		start().catch(error => {
			document.querySelector('#reference').textContent = "Couldn't load the snapshot: " + error.message;
			document.querySelector('#reference').setAttribute('role', 'alert');
		});
	`;
	const html = `<!doctype html>
<!-- Copyright (c) Microsoft Corporation. Licensed under the MIT License. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="A working snapshot of the Visual Studio Code Design System, topics, and interactive component fixtures.">
<title>Visual Studio Code Design System — Review snapshot</title><style>${css}</style></head>
<body class="design-reference explorer book-layout">
<a class="skip" href="#reference">Skip to content</a>
<header class="explorer-heading"><div><p class="book-title">Visual Studio Code Design System</p>
<p class="meta">Review snapshot · <time id="snapshot-date"></time> · Not a published specification</p>
<details><summary>About this snapshot</summary><p>A shared starting point for reviewing the topic breakdown and deciding what to document and centralize. Topic data and interactive fixtures are frozen; topics without documentation remain open work.</p><p>Share a topic using its address. This static page doesn't save shared comments or edits.</p><p>Source links open the base commit on GitHub; local working changes in this snapshot may differ.</p></details></div></header>
<div class="explorer-layout"><div id="book-navigation"></div><div class="explorer-article">
<main id="reference" tabindex="-1"><p role="status">Opening the design-system snapshot...</p></main><div id="book-pagination"></div>
</div></div><noscript>This interactive reference requires JavaScript.</noscript>
<script id="snapshot-payload" type="application/json">${safeJSON(payload)}</script>${script(bootstrap)}
</body></html>`;
	if (html.includes(root) || /https?:\/\/(?:localhost|127\.0\.0\.1):/.test(html)) { throw new Error('Export contains a machine-local dependency'); }
	await mkdir(path.dirname(destination), { recursive: true });
	await writeFile(destination, html);
	console.log(JSON.stringify({ file: destination, bytes: Buffer.byteLength(html), topics: selected.length,
		fixtures: new Set(snapshot.fixtures.controls.flatMap(item => item.variants.map(variant => variant.id))).size, commit: snapshot.commit, modified: snapshot.modified }, null, 2));
} finally {
	store.close();
	await browser?.close();
	await rm(scratch, { recursive: true, force: true });
}
