/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createDocumentCheckout, checkoutRoot } from './document-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { readDocument } from '../runtime/headless.mjs';
import { listCheckouts } from '../adapters/vscode/checkouts.mjs';
import { createBookRuntime } from '../runtime/lifecycle.mjs';
import { CheckoutStorage } from '../runtime/checkout-storage.mjs';
import { ViewStateStorage } from '../runtime/state-storage.mjs';

test('ordinary VS Code checkouts expose saved documentation without exploration metadata or tokens', async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	rmSync(path.join(fixture.root, 'src/vs/platform/theme/common/sizes'), { recursive: true });
	fixture.write('src/vs/base/common/lifecycle.ts', 'export interface IDisposable { dispose(): void; }\n');
	const panel = await createExplorer(fixture.root);
	t.after(() => panel.close());
	const listing = await (await fetch(new URL('/api/documents', panel.url))).json();
	const envelope = await (await fetch(new URL('/api/topic', panel.url))).json();
	assert.deepEqual({
		mode: panel.store.repository.projection.mode,
		topics: panel.state.scope.topics,
		feature: listing.results.some(document => document.id === 'src/vs/feature/feature-notes.md'),
		rendered: envelope.data.library.listing.results.length > 0,
		fixtures: envelope.capability.fixture,
		text: readDocument(fixture.root, 'src/vs/feature/feature-notes.md').markdown.includes('Keep user choices.'),
	}, { mode: 'basic', topics: ['documentation'], feature: true, rendered: true, fixtures: false, text: true });
	fixture.write('src/vs/feature/feature-notes.md', '# Saved edit\n\nRead the current checkout.\n');
	assert.equal(readDocument(fixture.root, 'src/vs/feature/feature-notes.md').title, 'Saved edit');
	fixture.write('.github/design-system/topics.json', '{"version":99}');
	assert.throws(() => readRepository(fixture.root), /unsupported version/);
});

test('checkout selection preserves the server and rejects invalid candidates without losing the current book', async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	const panel = await createExplorer(checkoutRoot, { scope: { operation: 'all', active: 'typography' } });
	t.after(() => panel.close());
	const origin = new URL(panel.url).origin;
	const richStore = panel.store;
	const response = await fetch(`${origin}/api/checkout`, {
		method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ root: fixture.root }),
	});
	assert.deepEqual({
		status: response.status, mode: (await response.json()).mode, root: panel.root,
		origin: new URL(panel.url).origin, oldClosed: richStore.closed, topic: panel.state.scope.active,
	}, { status: 200, mode: 'basic', root: fixture.root, origin, oldClosed: true, topic: 'documentation' });
	assert.throws(() => panel.selectCheckout({ root: '/definitely/not/a/checkout' }), /ENOENT/);
	assert.throws(() => panel.selectCheckout({ root: '../relative' }), /absolute/);
	assert.equal(panel.root, fixture.root);
	const forbidden = await fetch(`${origin}/api/checkout`, {
		method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
		body: JSON.stringify({ root: checkoutRoot }),
	});
	assert.equal(forbidden.status, 403);
	panel.selectCheckout({ root: checkoutRoot });
	assert.deepEqual({ mode: panel.store.repository.projection.mode, origin: new URL(panel.url).origin },
		{ mode: 'curated', origin });
});

test('an externally switched branch invalidates the catalog and document watches without switching branches itself', async t => {
	const fixture = createDocumentCheckout(t);
	execFileSync('git', ['init', '-q', '-b', 'exploration'], { cwd: fixture.root });
	const panel = await createExplorer(fixture.root, {
		scope: { operation: 'all', active: 'documentation' }, checkoutPollMs: 30,
	});
	t.after(() => panel.close());
	const oldStore = panel.store;
	rmSync(fixture.bookRoot, { recursive: true });
	execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/ordinary'], { cwd: fixture.root });
	await new Promise((resolve, reject) => {
		const deadline = Date.now() + 5000;
		const check = () => {
			if (panel.store.repository.projection.mode === 'basic') { resolve(); }
			else if (Date.now() > deadline) { reject(new Error('Branch change did not invalidate the curated catalog')); }
			else { setTimeout(check, 30); }
		};
		check();
	});
	assert.deepEqual({
		oldClosed: oldStore.closed, active: panel.state.scope.active,
		branch: listCheckouts(fixture.root)[0].branch,
	}, { oldClosed: true, active: 'documentation', branch: 'ordinary' });
});

test('checkout selection and its view survive provider recreation while corrupt selection remains explicit', async t => {
	const fixture = createDocumentCheckout(t);
	rmSync(fixture.bookRoot, { recursive: true });
	const home = path.join(fixture.root, 'private-home');
	const first = createBookRuntime(checkoutRoot, { home });
	await first.open('book');
	const origin = new URL(first.required('book').url).origin;
	first.required('book').selectCheckout({ root: fixture.root });
	first.required('book').setView({ documentId: 'src/vs/feature/feature-notes.md' });
	assert.equal(new URL(first.required('book').url).origin, origin);
	await first.close('book');
	const second = createBookRuntime(checkoutRoot, { home });
	try {
		await second.open('book', { root: checkoutRoot });
		assert.deepEqual({ root: second.rootFor('book'), document: second.required('book').view.documentId },
			{ root: fixture.root, document: 'src/vs/feature/feature-notes.md' });
		const selection = new CheckoutStorage(checkoutRoot, 'book', { home });
		fixture.write(path.relative(fixture.root, selection.file), '{broken');
		assert.throws(() => second.required('book').selectCheckout({ root: checkoutRoot }), /Couldn't save checkout/);
		assert.equal(second.rootFor('book'), fixture.root);
	} finally { await second.close('book'); }
});

test('a curated branch can remove saved topics without preventing the same panel from loading', async t => {
	const fixture = createDocumentCheckout(t);
	const runtime = createBookRuntime(fixture.root, { home: path.join(fixture.root, 'private-home') });
	await runtime.open('book');
	t.after(() => runtime.close('book'));
	const panel = runtime.required('book');
	panel.setScope({ topics: ['motion', 'typography'], active: 'motion', layout: 'compare' });
	panel.setView({ theme: 'Light 2026' }, 'motion');
	const book = JSON.parse(readFileSync(path.join(fixture.bookRoot, 'topics.json'), 'utf8'));
	book.topics = book.topics.filter(topic => topic.id !== 'motion');
	if (book.components?.after === 'motion') { book.components.after = 'tokens'; }
	if (book.references) { delete book.references.motion; }
	fixture.write('.github/design-system/topics.json', JSON.stringify(book));
	panel.selectCheckout({ root: fixture.root });
	const checkouts = await (await fetch(new URL('/api/checkouts', panel.url))).json();
	assert.deepEqual({
		scope: panel.state.scope, removed: Object.hasOwn(panel.state.views, 'motion'), notice: checkouts.unavailableTopics,
	}, {
		scope: { mode: 'focused', topics: ['typography'], active: 'typography', layout: 'single' },
		removed: false, notice: ['motion'],
	});
});

test('plugin packaging declares a native canvas entry without copying product content', () => {
	const root = new URL('../', import.meta.url);
	const manifest = JSON.parse(readFileSync(new URL('.plugin/plugin.json', root), 'utf8'));
	const marketplace = JSON.parse(readFileSync(new URL('.plugin/marketplace.json', root), 'utf8'));
	assert.deepEqual({
		name: manifest.name, extensions: manifest.extensions, version: manifest.version,
		entry: readFileSync(new URL('extensions/vscode-design-system/extension.mjs', root), 'utf8').includes("import '../../extension.mjs'"),
		release: marketplace.plugins[0].version,
	}, { name: 'vscode-design-system', extensions: 'extensions/', version: '0.4.0', entry: true, release: manifest.version });
});

test('same-checkout catalog refresh preserves navigation, adopts additions and moves, and rejects broken candidates transactionally', async t => {
	const fixture = createDocumentCheckout(t);
	const manifest = '.github/design-system/topics.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	const topic = id => ({
		id, title: id, section: id, group: 'Guidance', aliases: [`old-${id}`],
		renderer: 'guidance', page: `content/topics/${id}.json`, compare: true, fixture: false,
	});
	const writeTopic = (id, source, copy) => {
		fixture.write(source, `# ${id}\n\n## Introduction\n\n${copy}\n\n## Usage\n\n${copy}\n`);
		fixture.write(`.github/design-system/content/topics/${id}.json`, JSON.stringify({
			version: 1, id, renderer: 'guidance', source, content: {},
			sections: [{ id: `${id}-usage`, key: 'usage', heading: 'Usage' }],
		}));
	};
	writeTopic('routing-study', 'src/vs/feature/routing.md', 'First saved source.');
	const selectedBook = { ...book, components: undefined, references: {}, defaultTopic: 'routing-study', topics: [topic('routing-study')] };
	fixture.write(manifest, JSON.stringify(selectedBook));
	const storage = new ViewStateStorage(fixture.root, { home: path.join(fixture.root, 'private-home'), view: 'routing-test' });
	const panel = await createExplorer(fixture.root, { stateStorage: storage, watchCheckout: false });
	t.after(() => panel.close());
	panel.setScope({ topics: ['old-routing-study'], active: 'old-routing-study' });
	panel.setView({ theme: 'Light 2026', anchor: 'routing-study-usage' });
	const before = panel.state;
	const origin = new URL(panel.url).origin;
	const first = await panel.inspectTopic('old-routing-study', true);
	writeTopic('routing-study', 'src/vs/feature/relocated.md', 'Moved and updated source.');
	rmSync(path.join(fixture.root, 'src/vs/feature/routing.md'));
	await panel.refreshTopic();
	const moved = await panel.inspectTopic(undefined, true);
	writeTopic('second-study', 'src/vs/feature/second.md', 'New topic source.');
	fixture.write(manifest, JSON.stringify({ ...selectedBook, topics: [...selectedBook.topics, topic('second-study')] }));
	const oldStore = panel.store;
	panel.selectCheckout({ root: fixture.root });
	assert.deepEqual({
		first: first.data.authored.sections.usage.description.trim(),
		moved: moved.data.authored.sections.usage.description.trim(),
		state: panel.state, origin: new URL(panel.url).origin, oldClosed: oldStore.closed,
		newTopic: (await panel.inspectTopic('old-second-study', true)).data.authored.intro.trim(),
	}, {
		first: 'First saved source.', moved: 'Moved and updated source.', state: before, origin, oldClosed: true, newTopic: 'New topic source.',
	});
	panel.setScope({ operation: 'add', topics: ['second-study'], layout: 'compare' });
	const beforeInvalid = panel.state;
	const goodStore = panel.store;
	fixture.write(manifest, JSON.stringify({ ...selectedBook, topics: [topic('routing-study'), { ...topic('second-study'), renderer: 'motion' }] }));
	assert.throws(() => panel.selectCheckout({ root: fixture.root }), /Invalid book topic/);
	assert.deepEqual({ state: panel.state, sameStore: panel.store === goodStore, closed: goodStore.closed },
		{ state: beforeInvalid, sameStore: true, closed: false });
	fixture.write(manifest, JSON.stringify({ ...selectedBook, defaultTopic: 'second-study', topics: [topic('second-study')] }));
	panel.selectCheckout({ root: fixture.root });
	assert.deepEqual(panel.state.scope, { mode: 'focused', topics: ['second-study'], active: 'second-study', layout: 'single' });
	panel.setView({ theme: 'Dark 2026' });
	assert.deepEqual(new ViewStateStorage(fixture.root, { home: path.join(fixture.root, 'private-home'), view: 'routing-test' }).read().state.scope,
		panel.state.scope);
});

test('catalog rejects ambiguous topic routes and renderer contracts before serving content', t => {
	const fixture = createDocumentCheckout(t);
	const manifest = '.github/design-system/topics.json';
	const book = JSON.parse(readFileSync(path.join(fixture.root, manifest), 'utf8'));
	const topic = { id: 'routing-study', section: 'routing-study', group: 'Guidance', title: 'Routing study',
		renderer: 'guidance', aliases: ['previous-study'], page: 'content/topics/routing-study.json', fixture: false, compare: true };
	const writeTopics = topics => fixture.write(manifest, JSON.stringify({
		...book, components: undefined, references: {}, defaultTopic: 'routing-study', topics,
	}));
	writeTopics([topic]);
	const repository = readRepository(fixture.root);
	assert.deepEqual({
		alias: repository.getTopic('previous-study').id,
		route: repository.topicId({ section: 'previous-study' }),
		scope: repository.validateScope({ topics: ['previous-study'], active: 'previous-study' }).active,
	}, { alias: topic.id, route: topic.id, scope: topic.id });
	for (const change of [{ section: 'another-section' }, { renderer: 'motion' }, { renderer: 'unknown' }]) {
		writeTopics([{ ...topic, ...change }]);
		assert.throws(() => readRepository(fixture.root), /Invalid book topic/);
	}
	writeTopics([topic, { ...topic, id: 'previous-study', section: 'previous-study', aliases: [] }]);
	assert.throws(() => readRepository(fixture.root), /Conflicting topic alias/);
	writeTopics([topic, { ...topic, id: 'second-study', section: 'second-study' }]);
	assert.throws(() => readRepository(fixture.root), /Conflicting topic alias/);
	writeTopics([{ ...topic, aliases: ['components'] }]);
	assert.throws(() => readRepository(fixture.root), /Conflicting topic alias/);
});
