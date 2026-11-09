/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { catalog } from './repository-helpers.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

test('exact SDK adapter opens idempotently, scopes, stops and reopens without a provider reload', { skip: !vm.SourceTextModule }, async t => {
	const scratch = path.join(workspaceRoot, '.build');
	mkdirSync(scratch, { recursive: true });
	const home = mkdtempSync(path.join(scratch, 'design-adapter-state-'));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const { SourceTextModule, SyntheticModule, createContext } = vm;
	const entry = new URL('../extension.mjs', import.meta.url);
	let declaration;
	const context = createContext({ URL });
	const sdk = new SyntheticModule(['createCanvas', 'CanvasError', 'joinSession'], function () {
		this.setExport('createCanvas', input => input);
		this.setExport('CanvasError', class extends Error {
			constructor(code, message) { super(message); this.code = code; }
		});
		this.setExport('joinSession', async input => { declaration = input.canvases[0]; });
	}, { context });
	const module = new SourceTextModule(readFileSync(entry, 'utf8'), {
		context,
		initializeImportMeta: meta => { meta.url = entry.href; },
		importModuleDynamically: specifier => import(new URL(specifier, entry).href),
	});
	await module.link(async specifier => {
		if (specifier === '@github/copilot-sdk/extension') { return sdk; }
		const namespace = await import(specifier.startsWith('node:') ? specifier : new URL(specifier, entry).href);
		return new SyntheticModule(Object.keys(namespace), function () {
			for (const [key, value] of Object.entries(namespace)) {
				this.setExport(key, key === 'createBookRuntime' ? root => value(root, { home }) : value);
			}
		}, { context });
	});
	await module.evaluate();
	assert.equal(declaration.id, 'vscode-design-system');
	assert.equal(declaration.displayName, 'Visual Studio Code Design System');
	assert.equal(declaration.inputSchema.additionalProperties, false);
	const instanceId = 'adapter-contract-test';
	const action = (name, input = {}) => declaration.actions.find(item => item.name === name).handler({ instanceId, input });
	try {
		await assert.rejects(declaration.open({ instanceId: 'invalid-start', input: { topics: ['not-a-topic'] } }), /Unknown topic/);
		await declaration.onClose({ instanceId: 'invalid-start' });
		await declaration.open({ instanceId: 'complete-system-default', input: {} });
		const full = await declaration.actions.find(item => item.name === 'inspect_system').handler({ instanceId: 'complete-system-default' });
		assert.equal(full.scope.mode, 'all');
		assert.equal(full.scope.active, 'principles');
		assert.equal(full.scope.topics.length, catalog.filter(item => !item.hidden).length);
		await declaration.actions.find(item => item.name === 'set_scope').handler({ instanceId: 'complete-system-default', input: { topics: ['typography'] } });
		await declaration.onClose({ instanceId: 'complete-system-default' });
		const [first, concurrent] = await Promise.all([
			declaration.open({ instanceId, input: { topics: ['typography'] } }),
			declaration.open({ instanceId, input: { topics: ['typography'] } }),
		]);
		assert.equal(first.url, concurrent.url);
		assert.equal(new URL(first.url).search, '');
		assert.deepEqual((await (await fetch(new URL('/api/metrics', first.url))).json()).parses, {});
		assert.equal((await fetch(new URL('/api/system', first.url))).status, 404);
		assert.deepEqual((await (await fetch(new URL('/api/metrics', first.url))).json()).parses, {});
		const reopened = await declaration.open({ instanceId, input: { topics: ['spacing'] } });
		assert.equal(first.url, reopened.url);
		assert.ok(Buffer.byteLength(JSON.stringify(await action('list_topics'))) < 16384);
		await action('set_scope', { operation: 'add', topics: ['spacing'], layout: 'compare' });
		const receipt = await action('inspect_topic', { topic: 'spacing' });
		assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 2048);
		assert.equal(receipt.checkout, workspaceRoot);
		await action('refresh_topic', { topic: 'spacing' });
		const before = await action('inspect_system');
		const rehydrated = await declaration.open({ instanceId, input: {} });
		assert.equal(rehydrated.url, first.url);
		assert.equal(new URL(before.url).searchParams.get('layout'), 'compare');
		await action('stop_explorer');
		await assert.rejects(fetch(first.url));
		const restored = await declaration.open({ instanceId, input: {} });
		assert.notEqual(new URL(restored.url).port, new URL(first.url).port);
		const after = await action('inspect_system');
		assert.deepEqual(JSON.parse(JSON.stringify(after.scope)), JSON.parse(JSON.stringify(before.scope)));
		const documents = await action('list_documents', { query: 'Design-token usage in CSS', scope: 'instructions', limit: 1 });
		const documentId = documents.results[0].id;
		const read = await action('read_document', { id: documentId, anchor: 'choose-by-role', limit: 1000 });
		const opened = await action('open_document', { id: documentId, anchor: 'choose-by-role' });
		const state = await (await fetch(new URL('/api/state', restored.url))).json();
		assert.deepEqual({
			id: opened.document.id, title: opened.document.title, anchor: read.anchor,
			guidance: read.markdown.includes('Structural measurements'),
			active: state.scope.active, layout: state.scope.layout,
			selected: state.views.documentation.documentId,
		}, {
			id: '.github/instructions/design-tokens.instructions.md', title: 'Design-token usage in CSS', anchor: 'choose-by-role',
			guidance: true, active: 'documentation', layout: 'single',
			selected: '.github/instructions/design-tokens.instructions.md',
		});
		await action('stop_explorer');
		const resumed = await declaration.open({ instanceId, input: {} });
		assert.deepEqual(await (await fetch(new URL('/api/state', resumed.url))).json(), state);
	} finally { await declaration.onClose({ instanceId }); }
});
