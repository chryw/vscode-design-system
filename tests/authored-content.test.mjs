/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas tests execute directly in Node. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { catalog, validateBook, createControls, repository } from './repository-helpers.mjs';
import { contentText, sectionContent } from '../view/page-content.mjs';
import { bookRoot, contentPath, markdownSection, readContent, readPage, resolveContent } from '../adapters/vscode/groups/authored.mjs';
import { load as loadComponent } from '../adapters/vscode/groups/components.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { TopicStore } from '../runtime/store.mjs';

const book = repository.projection.book;
const curation = repository.projection.curation;

const root = workspaceRoot;
const read = file => readFileSync(path.join(root, file), 'utf8');
const amend = (file, transform) => candidate => candidate === file ? transform(read(candidate)) : read(candidate);

test('the manifest preserves every original visible and archived topic and binds each to a real page', () => {
	// Reading order can change without changing topic identities or deep links.
	const originalSemantics = book.topics.map(({ page, renderer, ...topic }) => topic).sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual({
		title: book.title, defaultTopic: book.defaultTopic, topics: catalog.length,
		visible: catalog.filter(topic => !topic.hidden).length,
		semantics: createHash('sha256').update(JSON.stringify(originalSemantics)).digest('hex'),
	}, {
		title: 'Visual Studio Code Design System', defaultTopic: 'principles', topics: 158, visible: 49,
		semantics: '20414d93be9d23ed441a1aa83616656e1d2bd52638e246af9430315878e7123d',
	});
	for (const entry of catalog) {
		assert.match(entry.renderer, /^topics\/[a-z]+\.mjs$/);
		const page = JSON.parse(read(contentPath(entry.page)));
		assert.deepEqual([page.version, page.id, page.renderer], [1, entry.section, entry.rendererKind], entry.id);
	}
	for (const section of new Set(catalog.filter(topic => topic.id !== 'motion').map(topic => topic.section))) {
		const { page, authored } = readPage(read, section);
		assert.equal(authored.id, page.id);
		assert.ok(authored.intro.trim(), section);
	}
});

test('prose, structured specimens, and authoritative excerpts project through tracked reads', () => {
	const original = readPage(read, 'typography').authored;
	const file = 'src/vs/platform/theme/common/sizes/typography.md';
	const updated = readPage(amend(file, text => text.replace('Type roles carry hierarchy.', 'Changed guidance from the saved book.')), 'typography').authored;
	assert.deepEqual({
		before: original.intro,
		after: updated.intro,
		specimenRoles: updated.composition.map(([id]) => id),
		section: sectionContent(updated, 'composition').title,
	}, {
		before: 'Type roles carry hierarchy. Choose the role before choosing a font stack.',
		after: 'Changed guidance from the saved book. Choose the role before choosing a font stack.',
		specimenRoles: ['fontSize.heading2', 'fontSize.body1', 'fontSize.body2', 'fontSize.label1', 'fontSize.label3'],
		section: 'Hierarchy and reading rhythm',
	});
	const source = 'src/vs/platform/theme/common/colors/COLORS.md';
	const reference = { $text: { file: source, heading: 'Usage', list: true } };
	assert.ok(resolveContent(reference, amend(source, text => text.replace('Reserve accent', 'Changed source: reserve accent')))[0].startsWith('Changed source:'));
	assert.equal(contentText(updated.baseline, { fontSize: '13px', lineHeight: '1.4em' }),
		'Workbench baseline: 13px text with 1.4em line-height. Individual widgets can override this.');
});

test('a saved authored edit invalidates only its dependent topic and refresh rereads its Markdown', { timeout: 10000 }, async () => {
	const file = 'src/vs/platform/theme/common/sizes/typography.md';
	const scratch = path.relative(process.cwd(), path.join(root, `.build/.authored-edit-${randomUUID()}.md`));
	const absolute = path.resolve(scratch);
	const original = read(file);
	writeFileSync(scratch, original);
	const watchers = new Map();
	let sourceChanged;
	const changed = new Promise(resolve => { sourceChanged = resolve; });
	const store = new TopicStore(root, {
		adapter: {
			...vscodeAdapter,
			sourcePath: (root, requested, packageRoot) => requested === file ? absolute : vscodeAdapter.sourcePath(root, requested, packageRoot),
		},
		onEvent: event => { if (event.kind === 'sources') { sourceChanged(event); } },
		watchFactory: (directory, _options, listener) => {
			watchers.set(directory, listener);
			return { on() {}, close() { watchers.delete(directory); } };
		},
	});
	try {
		const first = await store.read('typography', { theme: 'Dark 2026' });
		store.setSubscribed(['typography']);
		writeFileSync(scratch, original.replace('Type roles carry hierarchy.', 'This saved edit changes the introduction.'));
		watchers.get(path.dirname(absolute))('change', path.basename(absolute));
		const event = await changed;
		const second = await store.read('typography', { theme: 'Dark 2026' });
		const third = await store.read('typography', { theme: 'Dark 2026' }, { refresh: true });
		assert.deepEqual({
			tracked: first.sources.includes(file), eventTopics: event.topics, eventFiles: event.files,
			intro: second.data.authored.intro, refreshed: third.data.authored.intro,
		}, {
			tracked: true, eventTopics: ['typography'], eventFiles: [file],
			intro: 'This saved edit changes the introduction. Choose the role before choosing a font stack.',
			refreshed: 'This saved edit changes the introduction. Choose the role before choosing a font stack.',
		});
		writeFileSync(scratch, original.replace('## Introduction', '## Removed introduction'));
		await assert.rejects(store.read('typography', { theme: 'Dark 2026' }), /Expected one section "Introduction"/);
	} finally {
		store.close();
		rmSync(scratch, { force: true });
	}
});

test('component notes refresh independently while API signatures remain checked against product owners', () => {
	const file = 'src/vs/base/browser/ui/button/button-design.md';
	const changed = loadComponent({ read: amend(file, text => text.replace('Runs actions through', 'Changed component note: runs actions through')) }, 'button').controls[0];
	assert.ok(changed.docs.summary.startsWith('Changed component note:'));
	assert.ok(changed.docs.api.every(member => member.source.file === 'src/vs/base/browser/ui/button/button.ts' && member.source.line > 0));
	assert.throws(() => loadComponent({ read: amend('src/vs/base/browser/ui/button/button.ts', text => text.replace('set label(value: string | IMarkdownString);', 'set renamedLabel(value: string | IMarkdownString);')) }, 'button'),
		/Component documentation source changed/);
	const apiFile = `${bookRoot}content/components/references/button.json`;
	assert.throws(() => loadComponent({ read: amend(apiFile, text => {
		const value = JSON.parse(text);
		value.api[0][4] = 'src/not-an-owner.ts';
		return JSON.stringify(value);
	}) }, 'button'), /API source is not an owner/);
});

test('invalid manifests, content shapes, and source bindings fail instead of becoming empty guidance', () => {
	for (const change of [
		value => { value.version = 2; },
		value => { value.topics.push(value.topics[0]); },
		value => { value.topics[0].renderer = '../arbitrary.mjs'; },
		value => { value.topics[0].page = 'pages/../../outside.json'; },
		value => { value.defaultTopic = 'unknown'; },
	]) {
		const value = structuredClone(book);
		change(value);
		assert.throws(() => validateBook(value), /Invalid/);
	}
	const pageFile = `${bookRoot}pages/typography.json`;
	for (const change of [
		value => { value.renderer = 'icons'; },
		value => { value.content = 'content/../../outside.json'; },
		value => { value.sources[0].file = '/outside.md'; },
		value => { value.sources[0].heading = 'Missing source section'; },
		value => { value.sections.push(value.sections[0]); },
		value => { delete value.sections[0].id; },
		value => { value.guidance[0].before = '../outside'; },
	]) {
		assert.throws(() => readPage(amend(pageFile, text => {
			const value = JSON.parse(text);
			change(value);
			return JSON.stringify(value);
		}), 'typography'), /Invalid|Expected one section/);
	}
	const bodyFile = `${bookRoot}content/foundations/typography.json`;
	assert.throws(() => readPage(amend(bodyFile, text => {
		const value = JSON.parse(text);
		value.composition = [['fontSize.body1']];
		return JSON.stringify(value);
	}), 'typography'), /Invalid authored chapter/);
	assert.throws(() => readContent(() => '{"version":2}', 'content/foundations/typography.json'), /Invalid book content version/);
	const malformed = structuredClone(curation);
	malformed.productControls[0].groups = [42];
	assert.throws(() => createControls(malformed), /Invalid component curation/);
});

test('Markdown references reject missing, empty, ambiguous, and unsupported selectors', () => {
	const reference = { file: 'src/vs/platform/theme/common/sizes/typography.md', heading: 'Introduction' };
	for (const [value, source, expected] of [
		[{ $text: reference }, '# Elsewhere\n\nText', /found 0/],
		[{ $text: reference }, '## Introduction\n\n## Next\n\nText', /Empty content section/],
		[{ $text: reference }, '## Introduction\n\nOne\n\n## Introduction\n\nTwo', /found 2/],
		[{ $text: { ...reference, paragraph: 2 } }, '## Introduction\n\nOne', /Missing content paragraph/],
		[{ $text: { ...reference, list: true } }, '## Introduction\n\nNot a list', /not a list/],
		[{ $text: { ...reference, evaluate: 'anything' } }, '', /Invalid Markdown content reference/],
		[{ $text: { ...reference, file: '../outside.md' } }, '', /Invalid book source reference/],
		[{ $text: { ...reference, file: '.github/extensions/vscode-design-system/docs/architecture.md' } }, '', /Invalid book source reference/],
		[{ $unknown: reference }, '', /Unsupported book content binding/],
	]) {
		assert.throws(() => resolveContent(value, () => source), expected);
	}
	assert.equal(markdownSection('```md\n## Introduction\n```\n## Introduction\n\nReal paragraph', 'Introduction', 'example.md'), 'Real paragraph');
	assert.throws(() => contentText('Missing {value}', {}), /Missing specimen value/);
});
