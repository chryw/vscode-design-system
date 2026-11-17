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
	const originalSemantics = book.topics.filter(topic => topic.id !== 'illustration').map(({ page, renderer, ...topic }) => topic).sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual({
		title: book.title, defaultTopic: book.defaultTopic, topics: catalog.length,
		visible: catalog.filter(topic => !topic.hidden).length,
		semantics: createHash('sha256').update(JSON.stringify(originalSemantics)).digest('hex'),
	}, {
		title: 'Visual Studio Code Design System', defaultTopic: 'principles', topics: 159, visible: 50,
		semantics: '148614f227d1af23218b988ce282bf6d539daa85e0b6d2a8b19715d30d686c4e',
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
	const file = 'src/vs/platform/theme/common/sizes/typography.design.md';
	const introduction = markdownSection(read(file), 'Introduction', file);
	const updated = readPage(amend(file, text => text.replace(/\r\n?/g, '\n').replace(introduction, 'Changed guidance from the saved book.')), 'typography').authored;
	assert.deepEqual({
		before: original.intro,
		after: updated.intro,
		specimenRoles: updated.composition.map(([id]) => id),
		section: sectionContent(updated, 'composition').title,
	}, {
		before: introduction,
		after: 'Changed guidance from the saved book.',
		specimenRoles: original.composition.map(([id]) => id),
		section: sectionContent(original, 'composition').title,
	});
	const source = 'src/vs/platform/theme/common/colors/colors.design.md';
	const reference = { $text: { file: source, heading: 'Preserve component contracts', list: true } };
	assert.ok(resolveContent(reference, amend(source, text => text.replace('- Reserve accent', '- Changed source: reserve accent')))[0].startsWith('Changed source:'));
	assert.equal(contentText(updated.baseline, { fontSize: '13px', lineHeight: '1.4em' }),
		'Workbench baseline: 13px text with 1.4em line-height. Individual widgets can override this.');
});

test('guidance-only chapters project authored sections and saved source edits without viewer copy', () => {
	const file = '.github/design-system/guidance/illustration.design.md';
	const updated = readPage(amend(file, text => text.replace(
		'The art sits back so the task stays in front.',
		'Changed illustration guidance.',
	)), 'illustration');
	assert.deepEqual({
		intro: updated.authored.intro,
		sections: updated.sourceSections.map(section => [section.sectionId, section.title, section.source.file]),
		edited: updated.sourceSections[0].markdown.includes('Changed illustration guidance.'),
	}, {
		intro: markdownSection(read(file), 'Introduction', file),
		sections: [
			['illustration-principles', 'Principles', file],
			['illustration-usage', 'Usage', file],
			['illustration-style', 'Visual style', file],
			['illustration-accessibility', 'Accessibility', file],
			['illustration-review', 'Build and review', file],
		],
		edited: true,
	});
});

test('elevation guidance and scenario captions come from the owning document and reject incomplete composition', () => {
	const file = 'src/vs/platform/theme/common/elevation.design.md';
	const updated = readPage(amend(file, text => text.replace(
		'The editor leads; navigation and tools support it without becoming independent floating layers.',
		'Changed relationship caption.',
	)), 'elevation').authored;
	assert.match(updated.scenarios[0].caption, /Changed relationship caption/);
	assert.equal(updated.markdownSource, file);
	assert.doesNotMatch(read(file), /Lessons from other systems|atlassian\.design|fluent2\.microsoft\.design|storybooks\.fluentui\.dev|learn\.microsoft\.com\/en-us\/windows\/apps\/design/i);
	const content = `${bookRoot}content/foundations/elevation.json`;
	const page = `${bookRoot}pages/elevation.json`;
	const relocated = 'src/vs/platform/theme/common/elevation-guide.md';
	const relocatedRead = candidate => candidate === relocated ? read(file)
		: [content, page].includes(candidate) ? read(candidate).replaceAll(file, relocated) : read(candidate);
	assert.equal(readPage(relocatedRead, 'elevation').authored.markdownSource, relocated);
	const edited = readPage(amend(file, text => text
		.replace('These are implemented treatments, not a requirement to make every surface look identical.', 'Changed consumer guidance.')
		.replace('Put validation and recoverable errors in the current dialog.', 'Changed modal guidance.')
		.replace('Surface schematic: 1 pairs', 'Changed construction caption.')
		.replace("Pair the owning component's background and foreground.", 'Changed fill guidance.')
		.replace('Clipping schematic:', 'Changed hosting caption.')), 'elevation').authored;
	assert.deepEqual({
		consumerGuidance: edited.sections.shadows.paragraphs.some(text => text.includes('Changed consumer guidance.')),
		modalGuidance: edited.sections.role.paragraphs.some(text => text.includes('Changed modal guidance.')),
		constructionCaption: edited.construction.caption.startsWith('Changed construction caption.'),
		fillGuidance: edited.construction.parts[0].description.startsWith('Changed fill guidance.'),
		hostingCaption: edited.hosting.caption.startsWith('Changed hosting caption.'),
	}, { consumerGuidance: true, modalGuidance: true, constructionCaption: true, fillGuidance: true, hostingCaption: true });
	for (const change of [
		data => { delete data.markdownSource; },
		data => { data.markdownSource = 'src/vs/platform/theme/common/unlisted.md'; },
		data => { data.scenarios[0].id = 'unsupported'; },
		data => { delete data.scenarios[1].caption; },
		data => { delete data.construction.caption; },
		data => { data.construction.parts[0].tokens = []; },
		data => { delete data.hosting; },
		data => { data.shadowRoles[2].id = 'invented-shadow'; },
	]) {
		assert.throws(() => readPage(amend(content, text => {
			const data = JSON.parse(text);
			change(data);
			return JSON.stringify(data);
		}), 'elevation'), /Invalid authored chapter: elevation|Elevation Markdown source must be listed in page sources/);
	}
});

test('a saved authored edit invalidates only its dependent topic and refresh rereads its Markdown', { timeout: 10000 }, async () => {
	const file = 'src/vs/platform/theme/common/sizes/typography.design.md';
	const scratch = path.relative(process.cwd(), path.join(root, `.build/.authored-edit-${randomUUID()}.md`));
	const absolute = path.resolve(scratch);
	const original = read(file);
	const introduction = markdownSection(original, 'Introduction', file);
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
		writeFileSync(scratch, original.replace(/\r\n?/g, '\n').replace(introduction, 'This saved edit changes the introduction.'));
		watchers.get(path.dirname(absolute))('change', path.basename(absolute));
		const event = await changed;
		const second = await store.read('typography', { theme: 'Dark 2026' });
		const third = await store.read('typography', { theme: 'Dark 2026' }, { refresh: true });
		assert.deepEqual({
			tracked: first.sources.includes(file), eventTopics: event.topics, eventFiles: event.files,
			intro: second.data.authored.intro, refreshed: third.data.authored.intro,
		}, {
			tracked: true, eventTopics: ['typography'], eventFiles: [file],
			intro: 'This saved edit changes the introduction.',
			refreshed: 'This saved edit changes the introduction.',
		});
		writeFileSync(scratch, original.replace('## Introduction', '## Removed introduction'));
		await assert.rejects(store.read('typography', { theme: 'Dark 2026' }), /Expected one section "Introduction"/);
	} finally {
		store.close();
		rmSync(scratch, { force: true });
	}
});

test('Button reads its design document and derives API declarations without reference JSON', () => {
	const file = 'src/vs/base/browser/ui/button/button.design.md';
	const changed = loadComponent({ root, read: amend(file, text => text.replace('Runs actions through', 'Changed component note: runs actions through')) }, 'button').controls[0];
	assert.ok(changed.docs.summary.startsWith('Changed component note:'));
	assert.ok(changed.docs.api.every(member => member.source.file === 'src/vs/base/browser/ui/button/button.ts' && member.source.line > 0));
	const owner = 'src/vs/base/browser/ui/button/button.ts';
	const derived = loadComponent({ root, read: file => {
		if (file === `${bookRoot}content/components/references/button.json`) { throw new Error('Legacy Button reference must not be read'); }
		return file === owner ? read(file).replace('set label(value: string | IMarkdownString);', 'set label(value: number);') : read(file);
	} }, 'button').controls[0];
	assert.deepEqual({
		className: derived.docs.className, apiSource: derived.docs.apiSource,
		label: derived.docs.api.find(member => member.symbol === 'IButton.label'),
		secondary: derived.docs.api.find(member => member.symbol === 'IButtonOptions.secondary').optional,
	}, {
		className: 'Button / ButtonBar', apiSource: 'typescript',
		label: { name: 'label', type: 'number', optional: false, declaration: 'set label(value: number);', symbol: 'IButton.label', source: { file: owner, line: 71 } },
		secondary: true,
	});
	assert.throws(() => loadComponent({ root, read: amend(owner, text => text.replace('set label(value: string | IMarkdownString);', 'set renamedLabel(value: string | IMarkdownString);')) }, 'button'),
		/Expected one public component API member IButton.label/);
	assert.throws(() => loadComponent({ root, read: amend(file, text => text.replace('## Usage', '## Missing usage')) }, 'button'), /Expected one section "Usage"/);
});

test('Button preserves Markdown structure and rejects invalid API selectors and sources', () => {
	const file = 'src/vs/base/browser/ui/button/button.design.md';
	const edited = loadComponent({ root, read: amend(file, text => text.replace(
		'- Use a clear verb for the action.',
		'- Use a clear verb for the action.\n  - Keep `onDidClick` as the activation owner.',
	)) }, 'button').controls[0];
	assert.match(edited.docs.design.markdown, /  - Keep `onDidClick`/);
	const curation = `${bookRoot}content/components/curation.json`;
	for (const change of [
		family => { family.design = '../outside.design.md'; },
		family => { family.api = ['IButton.label', 'IButton.label']; },
		family => { family.api = ['ButtonBar._buttons']; },
		family => { family.api = ['IButton.missing']; },
	]) {
		assert.throws(() => loadComponent({ root, read: amend(curation, text => {
			const value = JSON.parse(text);
			change(value.families.find(([id]) => id === 'button')[1]);
			return JSON.stringify(value);
		}) }, 'button'), /Invalid component definition|Unsupported public component API|Expected one public component API/);
	}
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
	const reference = { file: 'src/vs/platform/theme/common/sizes/typography.design.md', heading: 'Introduction' };
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

test('scoped Markdown references resolve whole sections without repeated file paths', () => {
	const source = 'src/vs/platform/theme/common/motion/motion-examples.md';
	const reference = { description: { $text: 'Foundations' }, caption: { $text: 'Selection caption' } };
	const resolved = resolveContent(reference, read, { source });
	assert.deepEqual(resolved, {
		description: markdownSection(read(source), 'Foundations', source),
		caption: markdownSection(read(source), 'Selection caption', source),
	});
	assert.match(resolveContent(reference, amend(source, text => text.replace(
		'The selection indicator connects',
		'Changed source caption connects',
	)), { source }).caption, /^Changed source caption/);
	assert.throws(() => resolveContent(reference, read), /Invalid Markdown content reference/);
	assert.throws(() => resolveContent(reference, read, { source: '../outside.md' }), /Invalid book source reference/);
	assert.throws(() => resolveContent({ $text: 'Missing source section' }, read, { source }), /Expected one section/);
	assert.throws(() => resolveContent(reference, amend(source, text => `${text}\n## Foundations\n\nDuplicate.\n`), { source }), /found 2/);
});
