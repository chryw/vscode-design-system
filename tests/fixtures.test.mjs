/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { loadFixtureCatalog as load } from '../adapters/vscode/fixtures.mjs';
import { repository } from './repository-helpers.mjs';

const loadFixtureCatalog = (root, url, signal, tree) => load(root, url, signal, tree, repository);

function fixtureProject(t) {
	const scratch = path.join(workspaceRoot, '.build');
	mkdirSync(scratch, { recursive: true });
	const root = mkdtempSync(path.join(scratch, 'canvas-fixture-startup-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (file, content) => {
		const target = path.join(root, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
	};
	write('package.json', '{}');
	write('node_modules/@vscode/component-explorer-cli/dist/index.js', `
		const fs = require('node:fs');
		const file = 'startup.json';
		const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { starts: 0 };
		fs.writeFileSync(file, JSON.stringify({ starts: previous.starts + 1, args: process.argv.slice(2) }));
	`);
	write('node_modules/@modelcontextprotocol/sdk/client/stdio.js', `
		exports.StdioClientTransport = class {
			constructor(options) { this.options = options; }
			async close() { this.closed = true; }
		};
	`);
	write('node_modules/@modelcontextprotocol/sdk/client/index.js', `
		const state = exports.state = { calls: [], sourceTreeId: 'tree-1' };
		const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
		exports.Client = class {
			async connect(transport) { state.transport = transport; state.client = this; }
			async callTool(request, _, options) {
				state.calls.push({ request, options });
				if (state.failure) { return { isError: true, content: [{ type: 'text', text: state.failure }] }; }
				if (request.name === 'sessions') {
					if (!require('node:fs').existsSync(require('node:path').join(state.transport.options.cwd, 'startup.json'))) {
						throw new Error('No daemon running');
					}
					return result([{ name: 'current', sourceKind: 'current', sourceTreeId: state.sourceTreeId, serverUrl: 'http://127.0.0.1:5123' }]);
				}
				if (request.name === 'wait_for_update') {
					if (!state.stale) { state.sourceTreeId = 'tree-2'; }
					return { content: [{ type: 'text', text: 'Source tree updated' }] };
				}
				return result([{ groupPath: ['baseUI', 'Buttons'], fixtureId: 'baseUI/Buttons/Dark', fixtureName: 'Dark' }]);
			}
			async close() { this.closed = true; }
		};
	`);
	return { root, state: createRequire(path.join(root, 'package.json'))('@modelcontextprotocol/sdk/client/index.js').state };
}

test('a cold component request automatically starts its checkout renderer and allows startup time', async t => {
	const { root, state } = fixtureProject(t);
	const catalog = await loadFixtureCatalog(root);
	assert.deepEqual({
		cwd: state.transport.options.cwd,
		args: state.transport.options.args,
		startup: JSON.parse(readFileSync(path.join(root, 'startup.json'), 'utf8')),
		requests: state.calls.map(call => ({ name: call.request.name, timeout: call.options.timeout })),
		session: catalog.session,
		url: catalog.explorerUrl,
		variants: catalog.controls.find(control => control.id === 'button').variants.map(variant => variant.id),
		closed: [state.client.closed, state.transport.closed],
	}, {
		cwd: root,
		args: [path.join(root, 'node_modules/@vscode/component-explorer-cli/dist/index.js'), 'mcp',
			'--project', path.join(root, 'test/componentFixtures/component-explorer.json'), '--use-daemon', '--no-daemon-autostart', '--call-timeout', '60'],
		startup: { starts: 1, args: ['serve', '--project', path.join(root, 'test/componentFixtures/component-explorer.json'),
			'--background', '--redirectionPort', '0'] },
		requests: [{ name: 'sessions', timeout: 90000 }, { name: 'list_fixtures', timeout: 90000 }],
		session: 'current',
		url: 'http://127.0.0.1:5123/___explorer',
		variants: ['baseUI/Buttons/Dark'],
		closed: [true, true],
	});
});

test('subsequent discovery reuses the shared renderer after closing its discovery client', async t => {
	const { root, state } = fixtureProject(t);
	const first = await loadFixtureCatalog(root);
	const second = await loadFixtureCatalog(root);
	assert.deepEqual({ startupRequests: JSON.parse(readFileSync(path.join(root, 'startup.json'), 'utf8')).starts,
		url: second.explorerUrl, closed: [state.client.closed, state.transport.closed] },
	{ startupRequests: 2, url: first.explorerUrl, closed: [true, true] });
});

test('catalog failures remain visible and close both discovery resources', async t => {
	const { root, state } = fixtureProject(t);
	state.failure = 'Renderer could not start: missing rspack dependency';
	await assert.rejects(loadFixtureCatalog(root), /Renderer could not start: missing rspack dependency/);
	assert.deepEqual([state.client.closed, state.transport.closed], [true, true]);
});

test('daemon startup failures are reported before connecting to MCP', async t => {
	const { root, state } = fixtureProject(t);
	writeFileSync(path.join(root, 'node_modules/@vscode/component-explorer-cli/dist/index.js'),
		'process.stderr.write("Renderer startup failed"); process.exit(1);');
	await assert.rejects(loadFixtureCatalog(root), /Renderer startup failed/);
	assert.equal(state.transport, undefined);
});

test('closing a panel can cancel daemon startup before opening a discovery client', async t => {
	const { root, state } = fixtureProject(t);
	const lifetime = new AbortController();
	lifetime.abort();
	await assert.rejects(loadFixtureCatalog(root, '', lifetime.signal), { name: 'AbortError' });
	assert.equal(state.transport, undefined);
});

test('an explicit URL cannot select a renderer from another checkout', async t => {
	const { root, state } = fixtureProject(t);
	await assert.rejects(loadFixtureCatalog(root, 'http://127.0.0.1:9999'), /does not match a running Component Explorer session for this checkout/);
	assert.deepEqual([state.client.closed, state.transport.closed], [true, true]);
});

test('saved fixture refresh waits for a new tree without losing the AbortSignal contract', async t => {
	const { root, state } = fixtureProject(t);
	const lifetime = new AbortController();
	const result = await loadFixtureCatalog(root, '', lifetime.signal, 'tree-1');
	assert.deepEqual({
		tree: result.sourceTreeId,
		calls: state.calls.map(call => call.request.name),
		signalPreserved: state.calls.every(call => call.options.signal === lifetime.signal),
		closed: [state.client.closed, state.transport.closed],
	}, {
		tree: 'tree-2', calls: ['sessions', 'wait_for_update', 'sessions', 'list_fixtures'],
		signalPreserved: true, closed: [true, true],
	});
});

test('a stale saved fixture cannot be reported as a successful refresh', async t => {
	const { root, state } = fixtureProject(t);
	state.stale = true;
	await assert.rejects(loadFixtureCatalog(root, '', undefined, 'tree-1'), /did not publish the saved fixture change/);
	assert.deepEqual([state.client.closed, state.transport.closed], [true, true]);
});
