/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { catalog, getTopic, validateScope } from './repository-helpers.mjs';
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, renameSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { TopicStore, contained } from '../runtime/store.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { load as loadIcons } from '../adapters/vscode/groups/icons.mjs';
import { ViewStateStorage, copilotHome } from '../runtime/state-storage.mjs';
import { createBookRuntime } from '../runtime/lifecycle.mjs';
import { readBook, validateBook } from '../runtime/book.mjs';
import { listTopics, readReference, searchReference } from '../runtime/headless.mjs';
import { createDocumentCheckout, repositoryRoot } from './document-helpers.mjs';
import { copyReviewSources } from '../scripts/archive.mjs';
import { bookNavigation } from '../model/catalog.mjs';
import { defaultView, validateState } from '../runtime/view-state.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { hasRichMotion } from './motion-helpers.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';

const root = workspaceRoot;
const settings = { theme: 'Dark 2026', compareTheme: 'Light 2026', query: '', fixtureId: '', anchor: '' };
const sizeFile = 'src/vs/platform/theme/common/sizes/baseSizes.ts';
const scratch = prefix => {
	const directory = path.join(root, '.build');
	mkdirSync(directory, { recursive: true });
	const result = mkdtempSync(path.join(directory, prefix));
	cpSync(repositoryRoot, path.join(result, '.github/skills/design-system'), { recursive: true });
	return result;
};

test('generated catalogs use specification metadata and reject invalid metadata instead of falling back', t => {
	const fixture = createDocumentCheckout(t);
	const specification = '.github/skills/design-system/foundations/typography.design.md';
	fixture.write('.github/design-system/topics.json', '{"version":1,"id":"ignored","title":"Legacy map","topics":[]}');
	assert.equal(readRepository(fixture.root).getTopic('typography').title, 'Typography');
	fixture.write(specification, readFileSync(path.join(fixture.root, specification), 'utf8').replace(/^isDraft:.*\r?\n/m, '').replace('kind: "foundation"', 'kind: "foundation"\nisDraft: "invalid"'));
	assert.throws(() => readRepository(fixture.root), /invalid design specification metadata/);
});

test('review sources keep viewer implementation separate from repository data and code-local guidance', async () => {
	const directory = scratch('design-review-sources-');
	const output = path.join(directory, 'archive');
	try {
		await copyReviewSources(output);
		const manifest = '.github/skills/design-system/foundations/typography.design.md';
		const guidance = 'src/vs/base/browser/ui/button/button.design.md';
		assert.deepEqual({
			manifest: readFileSync(path.join(output, 'repository', manifest), 'utf8'),
			guidance: readFileSync(path.join(output, 'repository', guidance), 'utf8'),
			viewer: existsSync(path.join(output, 'book/view/context.mjs')),
			bundledData: ['topics.json', 'content', 'pages'].filter(file => existsSync(path.join(output, 'book', file))),
			productRuntime: existsSync(path.join(output, 'repository/src/vs/base/browser/ui/button/button.ts')),
		}, {
			manifest: readFileSync(path.join(root, manifest), 'utf8'),
			guidance: readFileSync(path.join(root, guidance), 'utf8'),
			viewer: true, bundledData: [], productRuntime: false,
		});
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('icon availability uses installed font code points, including aliases', () => {
	const checkout = scratch('design-icon-coverage-');
	try {
		const dependency = path.join(checkout, 'node_modules/@vscode/codicons/dist');
		mkdirSync(dependency, { recursive: true });
		writeFileSync(path.join(dependency, 'codicon.ttf'), 'font-fixture');
		writeFileSync(path.join(dependency, 'codicon.css'), '.codicon-add:before { content: "\\ea60" }');
		const { icons } = loadIcons({
			root: checkout,
			read: () => 'register(\'add\', 0xea60)\nregister(\'plus\', 0xea60)\nregister(\'future\', 0xecf9)',
			source: file => ({ file, line: 1 }),
		}, false, dependency);
		assert.deepEqual(icons.map(({ id, fontAvailable }) => ({ id, fontAvailable })), [
			{ id: 'add', fontAvailable: true }, { id: 'plus', fontAvailable: true }, { id: 'future', fontAvailable: false },
		]);
	} finally {
		rmSync(checkout, { recursive: true, force: true });
	}
});

test('the viewer font uses the session toolchain without allowing selected-source symlink escapes', async () => {
	const checkout = scratch('design-icon-checkout-');
	const dependencies = scratch('design-icon-dependencies-');
	let panel;
	try {
		mkdirSync(path.dirname(path.join(checkout, sizeFile)), { recursive: true });
		writeFileSync(path.join(checkout, sizeFile), '');
		const font = path.join(dependencies, '@vscode/codicons/dist/codicon.ttf');
		mkdirSync(path.dirname(font), { recursive: true });
		writeFileSync(font, 'selected-checkout-font-must-not-be-served');
		symlinkSync(dependencies, path.join(checkout, 'node_modules'), 'junction');
		assert.throws(() => contained(checkout, 'node_modules/@vscode/codicons/dist/codicon.ttf'), /Source symlink leaves checkout/);
		panel = await createExplorer(checkout);
		const response = await fetch(new URL('/codicon.ttf', panel.url));
		const bytes = readFileSync(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.ttf'));
		assert.deepEqual({
			status: response.status, type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()),
		}, { status: 200, type: 'font/ttf', bytes });
	} finally {
		await panel?.close();
		rmSync(checkout, { recursive: true, force: true });
		rmSync(dependencies, { recursive: true, force: true });
	}
});

test('shared source previews report their prerequisite without starting a component renderer', async () => {
	let discoveries = 0;
	const panel = await createExplorer(root, {
		scope: { topics: ['component-button'] },
		contentVersion: { root, selection: { kind: 'shared', branch: 'design/docs' }, label: 'Shared branch' },
		adapter: { ...vscodeAdapter, loadFixtureCatalog: async () => { discoveries++; throw new Error('Renderer must not start'); } },
	});
	try {
		const response = await fetch(new URL('/api/fixtures', panel.url));
		const result = await response.json();
		assert.deepEqual({
			status: response.status, availability: result.availability,
			message: result.reason.includes('prepared local checkout'), controls: result.controls, discoveries,
		}, { status: 200, availability: 'source-only', message: true, controls: [], discoveries: 0 });
	} finally { await panel.close(); }
});

test('catalog and scope validation are metadata-only, bounded and exact', async () => {
	const panel = await createExplorer(root);
	try {
		const origin = new URL(panel.url).origin;
		assert.equal(panel.state.scope.mode, 'all');
		assert.equal(panel.state.scope.active, 'principles');
		assert.equal(panel.state.scope.topics.length, catalog.filter(item => !item.hidden).length);
		assert.equal((await (await fetch(`${origin}/api/catalog`)).json()).topics.length, catalog.length);
		const { topics, utilities } = bookNavigation(catalog);
		const listed = listTopics(root).topics;
		assert.deepEqual({
			foundations: topics.filter(item => ['accessibility', 'content'].includes(item.id)).map(item => [item.id, item.group]),
			patterns: topics.filter(item => item.group === 'Patterns').map(item => item.id),
			patternOrder: topics.findLastIndex(item => item.group === 'Foundations') < topics.findIndex(item => item.id === 'modal')
				&& topics.findIndex(item => item.id === 'modal') < topics.findIndex(item => item.group === 'Components'),
			headlessPattern: listed.find(item => item.id === 'modal').group,
			utilities: utilities.map(item => item.id),
			groupedLibrary: topics.some(item => item.id === 'documentation'),
			headless: listed.find(item => item.id === 'documentation').navigation,
			defaultPlacement: listed.find(item => item.id === 'typography').navigation,
		}, {
			foundations: [['accessibility', 'Foundations'], ['content', 'Foundations']],
			patterns: catalog.filter(item => item.group === 'Patterns' && !item.hidden).map(item => item.id),
			patternOrder: true, headlessPattern: 'Patterns',
			utilities: [], groupedLibrary: false, headless: 'utility', defaultPlacement: 'topic',
		});
		const book = readBook(path.join(root, '.github/skills/design-system'));
		assert.ok(topics.findLastIndex(topic => topic.group === 'Foundations') < topics.findIndex(topic => topic.group === 'Components'),
			'Read the complete foundation sequence before component references');
		for (const navigation of ['unknown', false, null]) {
			assert.throws(() => validateBook({ ...book, topics: book.topics.map((topic, index) => index ? topic : { ...topic, navigation }) }), /topic/);
		}
		assert.deepEqual(panel.store.metrics, { reads: {}, parses: {}, bytes: 0 });
		panel.setScope({ operation: 'all', layout: 'single' });
		assert.deepEqual(panel.store.metrics, { reads: {}, parses: {}, bytes: 0 });
		const comparison = validateScope({ topics: ['typography', 'spacing'], layout: 'compare' });
		assert.equal(validateScope({ operation: 'all' }, comparison).layout, 'single');
		assert.ok(Buffer.byteLength(JSON.stringify({ topics: catalog.map(({ id, title }) => ({ id, title })) })) < 16384);
		assert.deepEqual(validateScope({ topics: ['components'], active: 'components' }).topics, ['component-button']);
		for (const input of [{ topics: ['nope'] }, { topics: ['typography'], layout: 'resizable' }, { topics: ['typography'], layout: 'compare' },
			{ topics: ['spacing', 'spacing'] }, { topics: ['spacing'], active: 'typography' }, { root: '/elsewhere', topics: ['spacing'] }]) {
			assert.throws(() => validateScope(input));
		}
	} finally { await panel.close(); }
});

test('component ordering preserves saved views and focused scope order', () => {
	const oldScope = validateScope({ operation: 'all', active: 'modal', layout: 'single' });
	oldScope.topics = oldScope.topics.filter(id => id !== 'modal');
	oldScope.topics.push('modal');
	const restored = validateState({ scope: oldScope, views: { modal: { theme: 'Light 2026' } } });
	const focused = validateScope({ topics: ['component-button', 'typography'], active: 'typography', layout: 'compare' });
	const hidden = catalog.find(topic => topic.hidden);
	assert.ok(hidden, 'expected a hidden topic in the current catalog');
	const archived = validateScope({ operation: 'all', active: hidden.id, layout: 'single' });
	// Topics from an earlier catalog that no longer have an owning specification are dropped, not rejected.
	const retired = validateState({
		scope: { mode: 'focused', topics: ['component-notebook', 'component-button'], active: 'component-notebook', layout: 'compare' },
		views: { 'component-notebook': { theme: 'Light 2026' } },
	}, undefined, { previousTopics: ['component-notebook', 'component-button'] });
	assert.deepEqual({
		scope: restored.scope, theme: restored.views.modal.theme,
		focused: validateState({ scope: focused, views: {} }).scope,
		archived: validateState({ scope: archived, views: {} }).scope,
		retired,
	}, {
		scope: validateScope({ operation: 'all', active: 'modal', layout: 'single' }), theme: 'Light 2026',
		focused, archived,
		retired: { scope: { mode: 'focused', topics: ['component-button'], active: 'component-button', layout: 'single' }, views: {} },
	});
	assert.throws(() => validateState({ scope: { mode: 'focused', topics: ['component-notebook'], active: 'component-notebook', layout: 'single' }, views: {} }),
		/Unknown topic: component-notebook/);
});

test('each checkout supplies its own catalog and viewer projection without a package-content fallback', async t => {
	const first = createDocumentCheckout(t);
	const second = createDocumentCheckout(t);
	const specification = '.github/skills/design-system/foundations/typography.design.md';
	second.write(specification, readFileSync(path.join(second.root, specification), 'utf8').replace('title: "Typography"', 'title: "Checkout type guidance"'));
	// Component titles come from each checkout's code-local specification front matter.
	const component = 'src/vs/base/browser/ui/button/button.design.md';
	const componentSpec = title => `---\ntitle: "${title}"\nkind: "component"\nisDraft: true\n---\n# ${title}\n\n## Overview\nStarts an action.\n\n## Usage\n- Label the action.\n\n## Accessibility\n- Keep it keyboard operable.\n\n## Preview\nNo live example is declared.\n`;
	first.write(component, componentSpec('Button'));
	second.write(component, componentSpec('Checkout action'));
	const panels = await Promise.all([createExplorer(first.root), createExplorer(second.root)]);
	try {
		const projections = await Promise.all(panels.map(async panel => (await fetch(new URL('/api/repository', panel.url))).json()));
		assert.deepEqual({
			defaults: panels.map(panel => panel.state.scope.active),
			titles: projections.map(projection => projection.book.topics.find(topic => topic.id === 'typography').title),
			controls: panels.map(panel => panel.store.repository.controls.find(control => control.id === 'button').name),
			headless: listTopics(second.root).topics.find(topic => topic.id === 'typography').title,
		}, {
			defaults: ['principles', 'principles'], titles: ['Typography', 'Checkout type guidance'],
			controls: ['Button', 'Checkout action'], headless: 'Checkout type guidance',
		});
	} finally { await Promise.all(panels.map(panel => panel.close())); }
	rmSync(path.join(second.bookRoot, 'foundations'), { recursive: true });
	rmSync(path.join(second.bookRoot, 'patterns'), { recursive: true });
	rmSync(path.join(second.root, component));
	const basic = await createExplorer(second.root);
	try {
		assert.deepEqual({ mode: basic.store.repository.projection.mode, topics: basic.state.scope.topics },
			{ mode: 'basic', topics: ['documentation'] });
	} finally { await basic.close(); }
});

test('shared-topic references are explicit, ordered, and validated from specification metadata', t => {
	const fixture = createDocumentCheckout(t);
	const first = { title: 'Text spacing', url: 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html', description: 'Check the required user text-spacing overrides.' };
	const second = { title: 'Variable fonts', url: 'https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview', description: 'Understand font-axis interpolation.' };
	const specification = '.github/skills/design-system/foundations/typography.design.md';
	const original = readFileSync(path.join(fixture.root, specification), 'utf8');
	const list = references => {
		fixture.write(specification, original.replace(/references:\n(?:[ \t]+.*\n)*/, `references: ${JSON.stringify(references)}\n`));
		return listTopics(fixture.root).topics;
	};
	const topics = list([second, first]);
	assert.deepEqual(['typography', 'spacing'].map(id => topics.find(topic => topic.id === id).references), [[second, first], []]);
	for (const references of [
		null, { typography: [first] }, [null], [{ ...first, description: ' ' }],
		[{ ...first, extra: true }], [{ ...first, url: 'not a URL' }],
		[{ ...first, url: 'javascript:alert(1)' }], [{ ...first, url: 'http://example.com' }],
		[{ ...first, url: 'https://user:password@example.com' }],
		[first, { ...first, url: first.url.replace('www.w3.org', 'WWW.W3.ORG:443') }],
	]) {
		assert.throws(() => list(references), /reference|metadata/i);
	}
});

test('Typography excludes unrelated readers, Spacing reuses registrations, all stays lazy', async () => {
	const store = new TopicStore(root);
	try {
		store.setSubscribed(['typography']);
		const typography = await store.read('typography', settings);
		const reads = Object.keys(store.metrics.reads);
		assert.equal(store.metrics.parses.sizes, 1);
		assert.ok(reads.every(file => !file.startsWith('extensions/') && !/codiconsLibrary|componentFixtures|button\.ts|switch\.css/.test(file)));
		assert.deepEqual(Object.keys(store.metrics.parses).sort(), ['guidance', 'sizes', 'sourceDocuments', 'typography']);
		assert.deepEqual({
			primary: typography.data.primarySourceDocument.id,
			// Related guidance stays linked inline; contributor resources list the Markdown the chapter actually read.
			provenanceRetained: typography.data.sourceDocuments.length > 0 && typography.data.sourceDocuments.every(document =>
				typography.data.resources.guidance.some(resource => resource.file === document.id)),
		}, {
			primary: '.github/skills/design-system/foundations/typography.design.md',
			provenanceRetained: true,
		});
		assert.equal(store.documentLibrary, undefined);
		store.setSubscribed(['typography', 'spacing']);
		const spacing = await store.read('spacing', settings);
		assert.equal(store.metrics.parses.sizes, 1);
		assert.equal(spacing.data.reference.scales.spacing.length, 14);
		assert.equal(spacing.data.spacing.patterns.length, 5);
		assert.equal(store.metrics.parses.spacing, 1);
		assert.equal(typography.data.typography.tokens.filter(item => item.id.startsWith('fontSize.') && !item.deprecated).length, 8);
		assert.ok(Buffer.byteLength(JSON.stringify(spacing)) < 128000);
		assert.ok(Buffer.byteLength(JSON.stringify({ ...spacing.data, catalog: [] })) < 50000);
		assert.equal(store.metrics.reads[sizeFile], 1);
	} finally { store.close(); }
});

test('every topic loads real sources or its document listing, a bounded summary and no fixture startup', async () => {
	const panel = await createExplorer(root);
	try {
		for (const entry of catalog) {
			const envelope = await panel.store.read(entry.id, settings);
			assert.equal(envelope.checkout, root);
			if (entry.rendererKind === 'documents') {
				assert.ok(envelope.data.library.listing.results.length > 0, entry.id);
			} else {
				assert.ok(envelope.sources.length > 0, entry.id);
			}
			assert.equal(envelope.topic, getTopic(entry.id).id);
			if (getTopic(entry.id).content === 'tbd') {
				assert.deepEqual(envelope.capability, { fixture: false, readiness: 'content-tbd' });
				assert.equal(envelope.sources.some(file => file.includes('componentFixtures')), false);
				const policy = (await import('../view/navigation-model.mjs')).topicPresentation(envelope.data, envelope.data.view);
				assert.equal(envelope.sources.includes(policy.source.file), true, entry.id);
			}
			assert.ok(Buffer.byteLength(JSON.stringify(await panel.inspectTopic(entry.id))) < 2048, entry.id);
		}
		const selected = panel.store.topics.get('component-button').envelope.sources;
		assert.ok(selected.includes('src/vs/base/browser/ui/button/button.ts'));
		assert.ok(!selected.includes('src/vs/base/browser/ui/radio/radio.ts'));
	} finally { await panel.close(); }
});

test('HTTP validates scope/view writes and source containment without an aggregate reader', async () => {
	const panel = await createExplorer(root);
	try {
		const origin = new URL(panel.url).origin;
		const post = (route, input, requestOrigin = origin) => fetch(`${origin}${route}`, {
			method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
		});
		assert.equal((await post('/api/scope', { operation: 'all' }, 'https://example.test')).status, 403);
		assert.equal((await post('/api/scope', { topics: ['unknown'] })).status, 400);
		assert.equal((await post('/api/view', { section: 'components', controlId: 'radio' })).status, 200);
		assert.equal(panel.state.scope.active, 'component-radio');
		await post('/api/view', { section: 'components', controlId: '' });
		assert.equal(panel.view.controlId, 'button');
		assert.equal((await (await fetch(`${origin}/api/topic?id=components`)).json()).topic, 'component-button');
		assert.equal((await post('/api/view', { explorerUrl: 'https://example.test/___explorer' })).status, 400);
		assert.equal((await post('/api/view', JSON.parse('{"__proto__":{"query":"invalid"}}'))).status, 400);
		assert.equal((await post('/api/scope', { operation: 'replace', topics: ['typography', 'spacing'], layout: 'compare' })).status, 200);
		const envelope = await (await fetch(`${origin}/api/topic?id=spacing`)).json();
		assert.equal(envelope.topic, 'spacing');
		const parses = panel.store.metrics.parses.sizes;
		const refreshed = await (await fetch(`${origin}/api/topic?id=spacing&refresh=true`)).json();
		assert.ok(refreshed.revision !== envelope.revision);
		assert.equal(panel.store.metrics.parses.sizes, parses + 1);
		assert.equal((await post('/api/refresh', { topics: ['typography', 'spacing'] })).status, 200);
		assert.equal((await post('/api/refresh', { topics: ['spacing', 'spacing'] })).status, 400);
		assert.equal((await post('/api/refresh', { topics: ['unknown'] })).status, 400);
		assert.equal((await post('/api/refresh', { topics: [] })).status, 400);
		assert.equal((await (await fetch(`${origin}/api/topic?id=typography`)).json()).topic, 'typography');
		assert.equal((await (await fetch(`${origin}/api/topic?id=spacing`)).json()).topic, 'spacing');
		assert.equal((await (await fetch(`${origin}/api/metrics`)).json()).fixtureRequests, 0);
		assert.equal((await fetch(`${origin}/source?file=${encodeURIComponent(sizeFile)}`)).status, 200);
		assert.equal((await fetch(`${origin}/source?file=../../etc/passwd`)).status, 404);
		assert.equal((await fetch(`${origin}/runtime/store.mjs`)).status, 404);
		assert.equal((await fetch(`${origin}/extension.mjs`)).status, 404);
		assert.ok(!Object.keys(panel.store.metrics.parses).includes('themes'));
		assert.equal((await fetch(`${origin}/api/system`)).status, 404);
		assert.ok(!Object.keys(panel.store.metrics.parses).includes('themes'));
	} finally { await panel.close(); }
});

function temporaryRoot() {
	const directory = scratch('design-explorer-test-');
	mkdirSync(path.dirname(path.join(directory, sizeFile)), { recursive: true });
	writeFileSync(path.join(directory, sizeFile), readFileSync(path.join(root, sizeFile)));
	return directory;
}

test('new and reconnected event clients receive the latest scope without changing it', async () => {
	const panel = await createExplorer(root);
	try {
		const origin = new URL(panel.url).origin;
		for (const input of [
			{ operation: 'replace', topics: ['typography'], active: 'typography', layout: 'single' },
			{ operation: 'add', topics: ['spacing'], layout: 'compare' },
		]) {
			panel.setScope(input);
			const expected = panel.state;
			const controller = new AbortController();
			try {
				const response = await fetch(`${origin}/api/events`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
				const reader = response.body.getReader();
				const chunk = await reader.read();
				const line = new TextDecoder().decode(chunk.value).split('\n').find(value => value.startsWith('data: '));
				assert.deepEqual({ event: JSON.parse(line.slice(6)), state: panel.state },
					{ event: { kind: 'scope', state: expected }, state: expected });
			} finally { controller.abort(); }
		}
	} finally { await panel.close(); }
});

test('shared dependency parsing deduplicates consumers and cancellation does not poison another', async () => {
	const store = new TopicStore(root);
	let finish;
	const load = () => new Promise(resolve => { finish = resolve; });
	try {
		const first = store.group('test', [], load);
		const second = store.group('test', [], load);
		await Promise.resolve();
		finish({ value: 42 });
		assert.deepEqual((await first).value, (await second).value);
		assert.equal(store.metrics.parses.test, 1);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(store.read('spacing', settings, { signal: controller.signal }), /cancelled/);
		assert.equal((await store.read('spacing', settings)).topic, 'spacing');
	} finally { store.close(); }
});

test('atomic saved edits invalidate shared dependencies and watches release on unsubscribe', async () => {
	const directory = temporaryRoot();
	const watchers = [];
	const events = [];
	const store = new TopicStore(directory, {
		watchFactory: (target, _options, callback) => {
			const watcher = new EventEmitter();
			watcher.close = () => { watcher.closed = true; };
			watchers.push({ target, callback, watcher });
			return watcher;
		}, onEvent: event => events.push(event),
	});
	try {
		// Isolate a reusable dependency without requiring a copied checkout's Git identity.
		const load = ({ read }) => read(sizeFile);
		const entry = await store.group('sizes', [], load);
		store.topics.set('spacing', { dependencies: [{ key: entry.key, revision: entry.revision }], declared: new Set([entry.key]), envelope: {} });
		store.setSubscribed(['spacing']);
		const replacement = path.join(directory, `${sizeFile}.tmp`);
		writeFileSync(replacement, readFileSync(path.join(directory, sizeFile), 'utf8').replace('sizeForAllThemes(4, \'px\')', 'sizeForAllThemes(5, \'px\')'));
		renameSync(replacement, path.join(directory, sizeFile));
		watchers[0].callback('rename', path.basename(sizeFile));
		const after = await store.group('sizes', [], load);
		assert.ok(after.value.includes('sizeForAllThemes(5, \'px\')'));
		assert.ok(after.revision > entry.revision);
		assert.equal(store.topics.get('spacing').envelope, undefined);
		watchers[0].watcher.emit('error', new Error('test watcher problem'));
		assert.match(events.at(-1).message, /test watcher problem/);
		store.setSubscribed([]);
		assert.ok(watchers.every(item => item.watcher.closed));
		assert.equal(store.watches.size, 0);
	} finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('missing sources recover and stale group completions never commit', async () => {
	const directory = temporaryRoot();
	const store = new TopicStore(directory);
	try {
		await assert.rejects(store.group('missing', [], ({ read }) => read('not-created.txt')), /ENOENT/);
		writeFileSync(path.join(directory, 'not-created.txt'), 'restored');
		assert.equal((await store.group('missing', [], ({ read }) => read('not-created.txt'))).value, 'restored');
		let resolve;
		const pending = store.group('late', [], () => new Promise(done => { resolve = done; }));
		await Promise.resolve();
		store.invalidate(store.groups.get(store.key('late')));
		resolve('stale');
		await assert.rejects(pending, /revision changed/);
	} finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('reused directory watchers observe newly subscribed files and filename-less events', async () => {
	const directory = temporaryRoot();
	const watchers = [];
	const events = [];
	const store = new TopicStore(directory, {
		watchFactory: (target, _options, callback) => {
			const watcher = new EventEmitter();
			watcher.close = () => {};
			watchers.push({ target, callback });
			return watcher;
		},
		onEvent: event => events.push(event),
	});
	try {
		for (const id of ['spacing', 'typography']) {
			const file = `${id}.txt`;
			writeFileSync(path.join(directory, file), 'initial');
			const entry = await store.group(id, [], ({ read }) => read(file));
			store.topics.set(id, { declared: new Set([entry.key]), dependencies: [entry] });
			store.setSubscribed([...store.subscribed, id]);
		}
		assert.equal(watchers.length, 1);
		writeFileSync(path.join(directory, 'typography.txt'), 'updated typography');
		watchers[0].callback('change', 'typography.txt');
		await new Promise(resolve => setTimeout(resolve, 130));
		writeFileSync(path.join(directory, 'spacing.txt'), 'updated spacing');
		await store.group('typography', [], ({ read }) => read('typography.txt'));
		watchers[0].callback('change', null);
		await new Promise(resolve => setTimeout(resolve, 130));
		assert.deepEqual(events.map(({ topics, files }) => ({ topics, files })), [
			{ topics: ['typography'], files: ['typography.txt'] },
			{ topics: ['spacing'], files: ['spacing.txt'] },
		]);
	} finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('topic reads automatically retry a racing source revision once, without retrying invalid data', async () => {
	let invalidated = false;
	class RacingStore extends TopicStore {
		async group(name, args, load) {
			const result = await super.group(name, args, load);
			if (name === 'sizes' && !invalidated) {
				invalidated = true;
				this.invalidate(this.groups.get(result.key));
			}
			return result;
		}
	}
	const store = new RacingStore(root);
	try {
		const result = await store.read('typography', settings);
		assert.deepEqual({
			topic: result.topic, sizeParses: store.metrics.parses.sizes,
			current: result.revision.includes(`sizes:${store.key('sizes').split(':')[1]}:1`),
		}, { topic: 'typography', sizeParses: 2, current: true });
		await assert.rejects(store.read('unknown-topic', settings), /Unknown topic/);
		assert.equal(store.metrics.parses.sizes, 2);
	} finally { store.close(); }
});

test('a missing subscribed source watches its existing parent and announces recovery', async () => {
	const directory = temporaryRoot();
	let callback;
	const events = [];
	const store = new TopicStore(directory, {
		watchFactory: (_target, _options, listener) => {
			callback = listener;
			const watcher = new EventEmitter(); watcher.close = () => {}; return watcher;
		},
		onEvent: event => events.push(event),
	});
	try {
		store.topics.set('spacing', { declared: new Set([store.key('missing')]) });
		await assert.rejects(store.group('missing', [], ({ read }) => read('new/future.txt')), /ENOENT/);
		store.setSubscribed(['spacing']);
		assert.ok(store.watches.size > 0);
		mkdirSync(path.join(directory, 'new'));
		writeFileSync(path.join(directory, 'new/future.txt'), 'created');
		callback('rename', 'new');
		await new Promise(resolve => setTimeout(resolve, 130));
		assert.deepEqual(events.filter(event => event.kind === 'sources').at(-1).topics, ['spacing']);
		assert.equal((await store.group('missing', [], ({ read }) => read('new/future.txt'))).value, 'created');
	} finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('roots reject symlink escapes and separate instances keep independent caches/views', async () => {
	const directory = temporaryRoot();
	const first = await createExplorer(root);
	const second = await createExplorer(root);
	try {
		symlinkSync(root, path.join(directory, 'escape'));
		assert.throws(() => contained(directory, 'escape/file.txt'), /symlink/);
		assert.throws(() => contained(directory, '../outside'), /relative/);
		assert.throws(() => { first.store.root = directory; }, TypeError);
		for (const file of ['.github/skills/design-system/foundations/spacing.design.md', '.github/instructions/design-tokens.instructions.md',
			'.github/skills/ux-css-layout/SKILL.md',
			'src/vs/sessions/contrib/automations/browser/media/automationDialog.css',
			'src/vs/workbench/contrib/chat/browser/aiCustomization/media/agentGlobalConfigurationSettings.css',
			'src/vs/workbench/test/browser/componentFixtures/baseUI.fixture.ts',
			'src/vs/base/browser/ui/button/button.ts',
			'src/vs/base/browser/ui/button/button.css']) {
			mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
			writeFileSync(path.join(directory, file), readFileSync(path.join(root, file)));
		}
		execFileSync('git', ['init', '-q', directory]);
		const isolated = await createExplorer(directory, { scope: { topics: ['spacing'] } });
		try {
			const envelope = await isolated.store.read('spacing', settings);
			assert.equal(envelope.checkout, isolated.root);
			assert.notEqual(envelope.checkout, first.root);
			assert.equal(Object.keys(first.store.metrics.reads).length, 0);
		} finally { await isolated.close(); }
		first.setView({ query: 'changed' });
		assert.equal(second.view.query, '');
		await first.store.read('spacing', settings);
		assert.deepEqual(second.store.metrics.reads, {});
	} finally { await first.close(); await second.close(); rmSync(directory, { recursive: true }); }
});

test('normal close ends streams, watchers and port without terminating another runtime', async () => {
	const first = await createExplorer(root);
	const second = await createExplorer(root);
	const origin = new URL(first.url).origin;
	try {
		await first.store.read('typography', settings);
		const events = await fetch(`${origin}/api/events`);
		const stream = events.body.getReader();
		await stream.read();
		await first.close();
		assert.equal((await stream.read()).done, true);
		await assert.rejects(fetch(origin));
		assert.equal((await fetch(second.url)).status, 200);
		assert.equal(first.store.watches.size, 0);
		await first.close();
	} finally { await first.close(); await second.close(); }
});

test('saved state survives a new provider and preserves out-of-scope filters, anchors and fixtures', async t => {
	const home = scratch('design-state-');
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const first = createBookRuntime(root, { home });
	const reopened = createBookRuntime(root, { home });
	try {
		await first.open('first', {});
		const panel = first.required('first');
		panel.setView({ section: 'components', controlId: 'button', fixtureId: 'baseUI/Buttons/Dark', anchor: 'examples', query: 'filter' });
		panel.setScope({ topics: ['spacing'], active: 'spacing' });
		panel.setView({ theme: 'Light 2026', anchor: 'spacing-ramp' });
		const before = panel.state;
		await first.stop('first');
		await reopened.open('first', {});
		assert.deepEqual(reopened.required('first').state, before);
		reopened.required('first').setScope({ operation: 'all', active: 'component-button' });
		assert.deepEqual({
			view: reopened.required('first').view,
			files: readdirSync(path.join(home, 'extension-data/vscode-design-system')).map(file => path.extname(file)),
			mode: statSync(new ViewStateStorage(root, { home, view: 'first' }).file).mode & 0o777,
		}, { view: before.views['component-button'], files: ['.json'], mode: 0o600 });
	} finally { await first.close('first'); await reopened.close('first'); }
});

test('independent panels preserve their own views across reopen and isolate checkout/book domains', async t => {
	const home = scratch('design-state-domains-');
	const checkout = temporaryRoot();
	t.after(() => { rmSync(home, { recursive: true, force: true }); rmSync(checkout, { recursive: true, force: true }); });
	const runtime = createBookRuntime(root, { home });
	try {
		await Promise.all([runtime.open('a'), runtime.open('b')]);
		runtime.required('a').setView({ query: 'from a' }, 'spacing');
		runtime.required('b').setView({ anchor: 'from-b' }, 'typography');
		runtime.required('a').setScope({ topics: ['spacing'] });
		const storage = new ViewStateStorage(root, { home, view: 'a' });
		const secondStorage = new ViewStateStorage(root, { home, view: 'b' });
		const firstState = runtime.required('a').state;
		const secondState = runtime.required('b').state;
		assert.deepEqual({
			spacing: storage.read().state.views.spacing.query,
			typography: secondStorage.read().state.views.typography.anchor,
			otherCheckout: new ViewStateStorage(checkout, { home, view: 'a' }).read(),
			otherBook: new ViewStateStorage(root, { home, book: 'another-book', view: 'a' }).read(),
		}, { spacing: 'from a', typography: 'from-b', otherCheckout: undefined, otherBook: undefined });
		const previousUrl = runtime.required('a').url;
		await runtime.open('a', { root: checkout });
		assert.deepEqual({ root: runtime.rootFor('a'), url: new URL(runtime.required('a').url).origin },
			{ root: checkout, url: new URL(previousUrl).origin });
		await runtime.open('a', { root });
		await runtime.stop('a');
		assert.equal((await fetch(runtime.required('b').url)).status, 200);
		await runtime.open('a');
		await runtime.stop('b');
		await runtime.open('b');
		assert.deepEqual([runtime.required('a').state, runtime.required('b').state], [firstState, secondState]);
	} finally { await runtime.close('a'); await runtime.close('b'); }
});

test('corrupt or unavailable storage is explicit and never overwrites saved data or live state', async t => {
	const home = scratch('design-state-failures-');
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const storage = new ViewStateStorage(root, { home, view: 'panel' });
	const runtime = createBookRuntime(root, { home });
	await runtime.open('panel');
	const panel = runtime.required('panel');
	const before = panel.state;
	try {
		writeFileSync(storage.file, '{corrupt');
		assert.throws(() => panel.setView({ query: 'not saved' }), /Couldn't restore saved/);
		assert.deepEqual(panel.state, before);
		assert.equal(readFileSync(storage.file, 'utf8'), '{corrupt');
		await runtime.stop('panel');
		await assert.rejects(runtime.open('panel'), /Couldn't restore saved/);
		rmSync(storage.file);
		storage.update(() => before);
		const record = JSON.parse(readFileSync(storage.file, 'utf8'));
		writeFileSync(storage.file, JSON.stringify({ ...record, version: 99 }));
		assert.throws(() => storage.read(), /Unsupported format/);
		writeFileSync(storage.file, JSON.stringify(record));
		writeFileSync(storage.lock, 'another active writer');
		assert.throws(() => storage.update(() => before), error => error.code === 'STATE_BUSY');
		assert.equal(readFileSync(storage.file, 'utf8'), JSON.stringify(record));
		rmSync(storage.lock);
		const blockedHome = path.join(home, 'not-a-directory');
		writeFileSync(blockedHome, '');
		assert.throws(() => new ViewStateStorage(root, { home: blockedHome }).update(() => before), /Couldn't save/);
	} finally { await runtime.close('panel'); }
});

test('records saved before catalog tracking retire topics the book no longer has', t => {
	const home = scratch('design-state-legacy-');
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const storage = new ViewStateStorage(root, { home, view: 'legacy' });
	const write = state => {
		mkdirSync(path.dirname(storage.file), { recursive: true });
		writeFileSync(storage.file, JSON.stringify({
			format: 'vscode-design-system-view', version: 1, identity: storage.identity, revision: 3, updatedAt: '2026-01-01T00:00:00.000Z', state,
		}));
	};
	write({
		scope: { mode: 'focused', topics: ['component-retired', 'typography'], active: 'component-retired', layout: 'compare' },
		views: { 'component-retired': { theme: 'Light 2026' }, typography: { theme: 'Light 2026' } },
	});
	const { unavailableTopics, state } = storage.read();
	assert.deepEqual({ unavailableTopics, scope: state.scope, views: Object.keys(state.views), theme: state.views.typography.theme }, {
		unavailableTopics: ['component-retired'],
		scope: { mode: 'focused', topics: ['typography'], active: 'typography', layout: 'single' },
		views: ['typography'], theme: 'Light 2026',
	});
	write({ scope: { mode: 'focused', topics: ['Not A Topic'], active: 'Not A Topic', layout: 'single' }, views: {} });
	assert.throws(() => storage.read(), /Couldn't restore saved.*Unknown topic: Not A Topic/);
});

test('Copilot home uses an explicit nonempty value without expanding it', () => {
	const original = process.env.COPILOT_HOME;
	try {
		process.env.COPILOT_HOME = 'relative-explicit-home';
		assert.equal(copilotHome(), 'relative-explicit-home');
	} finally {
		if (original === undefined) { delete process.env.COPILOT_HOME; } else { process.env.COPILOT_HOME = original; }
	}
});

test('book manifest and authored content are served only from their explicit contained roots', async t => {
	const bookRoot = scratch('design-book-content-');
	t.after(() => rmSync(bookRoot, { recursive: true, force: true }));
	const book = readBook();
	book.components.page = 'content/topics/components.json';
	writeFileSync(path.join(bookRoot, 'topics.json'), JSON.stringify(book));
	cpSync(repositoryRoot, bookRoot, { recursive: true });
	// An explicit manifest is the older curated layout, which also supplies its component and token inventories.
	mkdirSync(path.join(bookRoot, 'content/components'), { recursive: true });
	mkdirSync(path.join(bookRoot, 'content/foundations'), { recursive: true });
	writeFileSync(path.join(bookRoot, 'content/components/curation.json'), JSON.stringify({
		version: 1, archiveReason: 'Archived.', missingReference: 'No reference.', productControls: [], families: [], additions: [],
	}));
	writeFileSync(path.join(bookRoot, 'content/components/fixture-bindings.json'), JSON.stringify({ version: 1, spacing: {}, motion: [] }));
	writeFileSync(path.join(bookRoot, 'content/components/toolkit-specifications.json'), JSON.stringify({ version: 1, file: '', specifications: [] }));
	writeFileSync(path.join(bookRoot, 'content/foundations/token-domains.json'), JSON.stringify({ version: 1, domains: [], palettes: [] }));
	writeFileSync(path.join(bookRoot, 'content/article.md'), '# Authored guidance');
	writeFileSync(path.join(bookRoot, 'content/private.mjs'), 'not a content asset');
	symlinkSync(path.join(repositoryRoot, 'SKILL.md'), path.join(bookRoot, 'content/escape.json'));
	const panel = await createExplorer(root, { bookRoot });
	try {
		const request = route => fetch(new URL(route, panel.url));
		assert.deepEqual({
			title: (await (await request('/topics.json')).json()).title,
			article: await (await request('/content/article.md')).text(),
			privateModule: (await request('/content/private.mjs')).status,
			symlink: (await request('/content/escape.json')).status,
		}, { title: 'Visual Studio Code Design System', article: '# Authored guidance', privateModule: 404, symlink: 404 });
		assert.throws(() => validateBook({ ...book, version: 2 }), /manifest/);
		assert.throws(() => validateBook({ ...book, topics: [...book.topics, book.topics[0]] }), /manifest/);
		assert.throws(() => validateBook({ ...book, topics: book.topics.map((topic, index) =>
			index ? topic : { ...topic, renderer: '../../runtime/server.mjs' }) }), /topic/);
	} finally { await panel.close(); }
});

test('authored sources use the selected repository data root and keep independent checkout watches', async t => {
	const bookRoot = scratch('design-authored-root-');
	const checkout = temporaryRoot();
	t.after(() => { rmSync(bookRoot, { recursive: true, force: true }); rmSync(checkout, { recursive: true, force: true }); });
	cpSync(repositoryRoot, bookRoot, { recursive: true });
	mkdirSync(path.join(bookRoot, 'content'), { recursive: true });
	writeFileSync(path.join(bookRoot, 'content/example.md'), 'original guidance');
	const source = '.github/skills/design-system/content/example.md';
	const callbacks = new Map();
	const events = [];
	const store = new TopicStore(checkout, {
		bookRoot,
		onEvent: event => events.push(event),
		watchFactory: (directory, _options, callback) => {
			callbacks.set(directory, callback);
			const watcher = new EventEmitter();
			watcher.close = () => {};
			return watcher;
		},
	});
	try {
		const entry = await store.group('authored', [], ({ read }) => read(source));
		store.topics.set('spacing', { declared: new Set([entry.key]), dependencies: [entry], envelope: { sources: [source] } });
		store.setSubscribed(['spacing']);
		writeFileSync(path.join(bookRoot, 'content/example.md'), 'updated authored guidance');
		callbacks.get(path.join(bookRoot, 'content'))('change', 'example.md');
		await new Promise(resolve => setTimeout(resolve, 130));
		const updated = await store.group('authored', [], ({ read }) => read(source));
		assert.deepEqual({ text: updated.value, event: events.find(event => event.kind === 'sources')?.files },
			{ text: 'updated authored guidance', event: [source] });
	} finally { store.close(); }
});

test('headless read and search return bounded source-backed results without fixture discovery', async () => {
	const read = await readReference(root, 'typography', { limit: 1000 });
	const motion = await readReference(root, 'motion', { limit: 1000 });
	const button = await readReference(root, 'component-button', { limit: 1000 });
	const search = await searchReference(root, 'fontSize', { topics: ['typography'], limit: 3 });
	assert.ok(read.sources.length && read.guidance.length && JSON.stringify(read).length < 8000);
	assert.equal(read.guidance[0].file, '.github/skills/design-system/foundations/typography.design.md');
	assert.match(read.guidance[0].text, /^---[\s\S]+?\n---\n\n# Typography/);
	assert.equal(motion.guidance[0].file, '.github/skills/design-system/foundations/motion.design.md');
	assert.equal(button.guidance[0].file, 'src/vs/base/browser/ui/button/button.design.md');
	assert.deepEqual({ matches: search.results.length, bounded: search.truncated, sourceBacked: search.results.every(result => result.file && result.line > 0) },
		{ matches: 3, bounded: true, sourceBacked: true });
	await assert.rejects(searchReference(root, ''), /2–200/);
});

test('headless reads prioritize Motion definitions and component APIs over rendering dependencies', async () => {
	const motion = await readReference(root, 'motion', { limit: 24000 });
	const button = await readReference(root, 'component-button');
	assert.deepEqual({
		motionKinds: [...new Set(motion.definitions.map(item => item.definitionKind))].sort(),
		motionSources: motion.definitions.every(item => item.id.startsWith('motion.') && item.source.file.startsWith('src/')),
		buttonApi: button.definitions.some(item => item.name === 'onDidClick' && item.source.file.endsWith('/button/button.ts')),
		buttonKinds: [...new Set(button.definitions.map(item => item.definitionKind))],
		readiness: button.capability.readiness,
	}, {
		motionKinds: hasRichMotion ? ['motion-analysis', 'motion-preset', 'motion-preset-binding', 'motion-recipe', 'motion-response', 'motion-token'] : [],
		motionSources: true,
		buttonApi: true,
		buttonKinds: ['component-api'],
		readiness: 'source-ready',
	});
});

test('GUI topics and bounded agent reads share normalized source resources without fixture discovery', async () => {
	const store = new TopicStore(root);
	try {
		const topic = await store.read('component-button', defaultView('component-button', store.repository));
		const agent = await readReference(root, 'component-button', { limit: 24000 });
		assert.deepEqual({
			api: agent.definitions, examples: agent.examples, guidance: agent.guidance[0].file,
		}, {
			api: topic.data.resources.definitions, examples: topic.data.resources.examples,
			guidance: topic.data.controls[0].docs.design.id,
		});
	} finally { store.close(); }
});

test('headless reads reject components without owning guidance and enforce their excerpt budget', async () => {
	// A family without a code-local specification has no topic; readers search the documentation library instead.
	await assert.rejects(readReference(root, 'component-breadcrumbs'), /Unknown topic: component-breadcrumbs/);
	const bounded = await readReference(root, 'component-button', { limit: 1000 });
	const used = bounded.summary.length + bounded.guidance.reduce((sum, entry) => sum + entry.text.length, 0)
		+ bounded.definitions.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0)
		+ bounded.examples.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0);
	assert.deepEqual({
		withinBudget: used <= 1000,
		omittedDefinitions: bounded.definitionCount > bounded.definitions.length,
		truncated: bounded.truncated,
	}, { withinBudget: true, omittedDefinitions: true, truncated: true });
});

test('headless search reports optional missing sources while returning available guidance', async t => {
	const checkout = temporaryRoot();
	t.after(() => rmSync(checkout, { recursive: true, force: true }));
	const missing = 'src/vs/platform/theme/common/motion/motionRecipes.ts';
	const store = new TopicStore(root);
	try {
		const reference = await store.read('tokens', settings);
		for (const file of reference.sources.filter(file => file !== missing && !file.startsWith('.github/extensions/'))) {
			if (!existsSync(store.sourcePath(file))) { continue; }
			const target = path.join(checkout, file);
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(target, readFileSync(store.sourcePath(file)));
		}
	} finally { store.close(); }
	const guidance = path.join(checkout, '.github/skills/design-system/foundations/tokens.design.md');
	writeFileSync(guidance, `${readFileSync(guidance, 'utf8')}\n\nheadless-missing-source-probe\n`);
	const result = await searchReference(checkout, 'headless-missing-source-probe', { topics: ['tokens'] });
	assert.deepEqual({
		foundGuidance: result.results.some(item => item.file.endsWith('/tokens.design.md') && item.text.includes('headless-missing-source-probe')),
		reportsMissing: result.unavailableSources.includes(missing),
		incomplete: result.incomplete,
		truncated: result.truncated,
	}, { foundGuidance: true, reportsMissing: true, incomplete: true, truncated: false });
});
