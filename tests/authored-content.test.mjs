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
import { catalog, controls, validateBook, createControls, repository } from './repository-helpers.mjs';
import { contentText, sectionContent } from '../view/page-content.mjs';
import { bookRoot, contentPath, markdownSection, readContent, readPage, resolveContent } from '../adapters/vscode/groups/authored.mjs';
import { load as loadComponent } from '../adapters/vscode/groups/components.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { documentControl } from '../adapters/vscode/component-docs.mjs';
import { createRepository } from '../model/repository.mjs';

const book = repository.projection.book;
const curation = repository.projection.curation;

const root = workspaceRoot;
const read = file => readFileSync(path.join(root, file), 'utf8');
const amend = (file, transform) => candidate => candidate === file ? transform(read(candidate)) : read(candidate);

test('the manifest preserves every original visible and archived topic and binds each to a real page', () => {
	// Reading order can change without changing topic identities or deep links.
	const originalSemantics = book.topics.filter(topic => !['illustration', 'modal'].includes(topic.id)).map(({ page, renderer, kind, design, ...topic }) => topic).sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual({
		title: book.title, defaultTopic: book.defaultTopic, topics: catalog.length,
		visible: catalog.filter(topic => !topic.hidden).length,
		semantics: createHash('sha256').update(JSON.stringify(originalSemantics)).digest('hex'),
	}, {
		title: 'Visual Studio Code Design System', defaultTopic: 'principles', topics: 160, visible: 51,
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

test('one component collection derives registrations and aliases without a second topic inventory', () => {
	const input = structuredClone(repository.projection);
	input.book.components = { after: 'tokens', page: 'content/topics/components.json' };
	input.book.topics = input.book.topics.filter(topic => topic.section !== 'components');
	const derived = createRepository(input);
	const byId = topics => [...topics].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(derived.projection.book.topics), byId(book.topics));
	input.curation.additions.push({ id: 'architecture-probe', name: 'Architecture probe', groups: [], reason: 'Test-only component.' });
	assert.equal(createRepository(input).getTopic('component-architecture-probe').title, 'Architecture probe');
	input.book.components.after = 'missing-topic';
	assert.throws(() => createRepository(input), /Invalid design-system book manifest/);
});

test('component navigation interleaves authored and generated topics without changing other entries', () => {
	const input = structuredClone(repository.projection);
	input.book.topics = input.book.topics.filter(topic => topic.section !== 'components');
	input.book.components = { after: 'motion', page: 'content/topics/components.json' };
	const modal = input.book.topics.find(topic => topic.id === 'modal');
	const probe = { ...modal, group: 'Components', id: 'modal-probe', section: 'modal-probe', title: 'Modal probe', aliases: [], page: 'content/topics/modal-probe.json' };
	const alert = { ...probe, id: 'alert-guide', section: 'alert-guide', title: 'Alert', page: 'content/topics/alert-guide.json' };
	const hidden = { ...probe, id: 'hidden-guide', section: 'hidden-guide', title: 'Hidden guide', page: 'content/topics/hidden-guide.json', hidden: true };
	const utility = { ...probe, id: 'order-tool', section: 'order-tool', title: 'Order tool', page: 'content/topics/order-tool.json', navigation: 'utility' };
	input.book.topics.splice(input.book.topics.findIndex(topic => topic.id === 'tokens') + 1, 0, hidden, utility);
	input.book.topics.push(probe, alert);
	const unsortedIds = input.book.topics
		.filter(topic => topic.group !== 'Components' || topic.hidden || topic.navigation === 'utility').map(topic => topic.id);
	const derived = createRepository(input);
	const names = derived.catalog.filter(topic => topic.group === 'Components' && !topic.hidden && topic.navigation !== 'utility')
		.map(topic => topic.title);
	const modalIndex = names.indexOf('Modal probe');
	const unsortedIdSet = new Set(unsortedIds);
	assert.deepEqual({
		names, modalNeighbors: names.slice(modalIndex - 1, modalIndex + 2),
		otherOrder: derived.projection.book.topics.filter(topic => unsortedIdSet.has(topic.id)).map(topic => topic.id),
		authored: [modal, probe, alert, hidden, utility].map(topic => derived.projection.book.topics.find(item => item.id === topic.id)),
		alias: derived.getTopic('management modal').id,
	}, {
		names: [...names].sort((a, b) => a.localeCompare(b, 'en')), modalNeighbors: ['Menu', 'Modal probe', 'Multi-select'],
		otherOrder: unsortedIds, authored: [modal, probe, alert, hidden, utility], alias: 'modal',
	});

	const materialized = structuredClone(derived.projection);
	const first = materialized.book.topics.findIndex(topic => topic.id === 'alert-guide');
	const last = materialized.book.topics.findIndex(topic => topic.id === 'modal-probe');
	[materialized.book.topics[first], materialized.book.topics[last]] = [materialized.book.topics[last], materialized.book.topics[first]];
	const reordered = createRepository(materialized).catalog
		.filter(topic => topic.group === 'Components' && !topic.hidden && topic.navigation !== 'utility').map(topic => topic.title);
	assert.deepEqual(reordered, names);
});

test('prose, structured specimens, and authoritative excerpts project through tracked reads', () => {
	const original = readPage(read, 'typography').authored;
	const file = '.github/design-system/typography.design.md';
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
	const source = '.github/design-system/colors.design.md';
	const reference = { $text: { file: source, heading: 'Preserve component contracts', list: true } };
	assert.ok(resolveContent(reference, amend(source, text => text.replace('- Reserve accent', '- Changed source: reserve accent')))[0].startsWith('Changed source:'));
	assert.equal(contentText(updated.baseline, { fontSize: '13px', lineHeight: '1.4em' }),
		'Workbench baseline: 13px text with 1.4em line-height. Individual widgets can override this.');
});

test('source composition supports both topic-map locations and rejects malformed new maps', () => {
	const current = `${bookRoot}topics.json`;
	const legacy = `${bookRoot}book.json`;
	const map = JSON.parse(read(current));
	const original = readPage(read, 'typography');
	const old = { ...map, topics: map.topics.map(topic => ({ ...topic, page: topic.page.replace(/^content\/topics\//, 'pages/') })) };
	const legacyRead = file => {
		if (file === current) { const error = new Error('Missing new map'); error.code = 'ENOENT'; throw error; }
		if (file === legacy) { return JSON.stringify(old); }
		return read(file.replace(`${bookRoot}pages/`, `${bookRoot}content/topics/`));
	};
	assert.deepEqual(readPage(legacyRead, 'typography'), original);
	assert.throws(() => readPage(file => file === current ? '{broken' : legacyRead(file), 'typography'), /Couldn't read topics.json/);
});

test('guidance-only chapters project authored sections and saved source edits without viewer copy', () => {
	const file = '.github/design-system/illustration.design.md';
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

test('accessibility composes source guidance while retaining legacy heading-order pages', () => {
	const file = '.github/design-system/accessibility.design.md';
	const updated = readPage(amend(file, text => text.replace(
		'Every action must work without a mouse.', 'Changed keyboard guidance.',
	)), 'accessibility');
	const page = `${bookRoot}content/topics/accessibility.json`;
	const legacy = readPage(amend(page, text => {
		const value = JSON.parse(text);
		delete value.guidance;
		value.content = { headingOrder: ['Keyboard Navigation'] };
		return JSON.stringify(value);
	}), 'accessibility');
	assert.deepEqual({
		edited: updated.sourceSections[0].markdown.includes('Changed keyboard guidance.'),
		sources: [...new Set(updated.sourceSections.map(section => section.source.file))],
		modernOrder: updated.authored.headingOrder,
		legacyOrder: legacy.authored.headingOrder,
		legacySections: legacy.sourceSections,
	}, {
		edited: true, sources: [file], modernOrder: undefined,
		legacyOrder: ['Keyboard Navigation'], legacySections: [],
	});
	assert.throws(() => readPage(amend(page, text => {
		const value = JSON.parse(text);
		value.guidance[0].heading = 'Missing keyboard guidance';
		return JSON.stringify(value);
	}), 'accessibility'), /Missing keyboard guidance/);
	assert.throws(() => readPage(amend(page, text => {
		const value = JSON.parse(text);
		delete value.guidance;
		return JSON.stringify(value);
	}), 'accessibility'), /Invalid authored chapter: accessibility/);
});

test('elevation guidance and scenario captions come from the owning document and reject incomplete composition', () => {
	const file = '.github/design-system/elevation.design.md';
	const updated = readPage(amend(file, text => text.replace(
		'The editor leads; navigation and tools support it without becoming independent floating layers.',
		'Changed relationship caption.',
	)), 'elevation').authored;
	assert.match(updated.scenarios[0].caption, /Changed relationship caption/);
	assert.equal(updated.markdownSource, file);
	assert.doesNotMatch(read(file), /Lessons from other systems|atlassian\.design|fluent2\.microsoft\.design|storybooks\.fluentui\.dev|learn\.microsoft\.com\/en-us\/windows\/apps\/design/i);
	const page = `${bookRoot}content/topics/elevation.json`;
	const definition = JSON.parse(read(page));
	const inline = typeof definition.content === 'object';
	const content = inline ? page : `${bookRoot}${definition.content}`;
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
		data => { data.scenarios[0].id = 'unsupported'; },
		data => { delete data.scenarios[1].caption; },
		data => { delete data.construction.caption; },
		data => { data.construction.parts[0].tokens = []; },
		data => { delete data.hosting; },
		data => { data.shadowRoles[2].id = 'invented-shadow'; },
	]) {
		assert.throws(() => readPage(amend(content, text => {
			const data = JSON.parse(text);
			change(inline ? data.content : data);
			return JSON.stringify(data);
		}), 'elevation'), /Invalid authored chapter: elevation|Elevation Markdown source must be listed in page sources/);
	}
	for (const source of [undefined, '../outside.md']) {
		assert.throws(() => readPage(amend(content, text => {
			const data = JSON.parse(text);
			if (inline) { data.source = source; }
			else { data.markdownSource = source; }
			return JSON.stringify(data);
		}), 'elevation'), /Invalid book page|Invalid book source reference|Invalid authored chapter|Elevation Markdown source/);
	}
});

test('a saved authored edit invalidates only its dependent topic and refresh rereads its Markdown', { timeout: 10000 }, async () => {
	const file = '.github/design-system/typography.design.md';
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
		family => { family.design = 'src/vs/base/browser/ui/button/Button.design.md'; },
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

test('component source APIs include inherited accessors, constructors, inferred types, and exported functions', () => {
	const selected = [
		['checkbox', 'src/vs/base/browser/ui/toggle/checkbox.design.md', ['Checkbox.constructor', 'Checkbox.checked']],
		['radio', 'src/vs/base/browser/ui/radio/radio.design.md', ['Radio.onDidSelect']],
		['badge', 'src/vs/base/browser/ui/countBadge/count-badge.design.md', ['CountBadge.setCount']],
		['spinner', 'src/vs/base/browser/ui/pixelSpinner/pixel-spinner.design.md', ['createPixelSpinner']],
	];
	const api = selected.flatMap(([id, design, api]) => documentControl({
		...controls.find(control => control.id === id), content: 'ready', design, api,
	}, read, undefined, root).docs.api);
	assert.deepEqual(api.map(member => [member.symbol, member.type]), [
		['Checkbox.constructor', 'Checkbox'], ['Checkbox.checked', 'boolean'], ['Radio.onDidSelect', 'Event<number>'],
		['CountBadge.setCount', 'void'], ['createPixelSpinner', 'IPixelSpinner'],
	]);
	assert.match(api[1].declaration, /get checked\(\): boolean;[\s\S]*set checked/);
	const radio = documentControl({ ...controls.find(control => control.id === 'radio'), content: 'ready',
		design: selected[1][1], api: ['Radio.onDidSelect'] },
	amend('src/vs/base/browser/ui/radio/radio.ts', text => text.replace('new Emitter<number>()', 'new Emitter<string>()')), undefined, root);
	assert.equal(radio.docs.api[0].type, 'Event<string>');
});

test('inline chapter composition reads complete source sections without paragraph projections', () => {
	const file = '.github/design-system/typography.design.md';
	const page = `${bookRoot}content/topics/typography.json`;
	const original = readPage(read, 'typography').authored;
	const candidate = {
		version: 1, id: 'typography', renderer: 'typography', source: file, sources: [],
		content: { sampleText: original.sampleText, baseline: original.baseline, composition: original.composition },
		sections: Object.entries(original.sections).map(([key, section]) => ({
			id: `typography-${key}`, key, heading: section.title,
		})),
	};
	const projection = readPage(requested => requested === page ? JSON.stringify(candidate) : requested === file
		? read(file).replace('## Hierarchy and reading rhythm', '## Hierarchy and reading rhythm\n\nAdditional paragraph from the owner.')
		: read(requested), 'typography');
	assert.deepEqual({
		text: projection.authored.sections.composition.description,
		paragraphSelectors: projection.authored.sections.composition.paragraphs,
		primary: projection.authored.markdownSource,
	}, {
		text: `Additional paragraph from the owner.\n\n${markdownSection(read(file), 'Hierarchy and reading rhythm', file)}`,
		paragraphSelectors: [], primary: file,
	});
	assert.throws(() => readPage(requested => requested === page
		? JSON.stringify({ ...candidate, content: { ...candidate.content, intro: 'Copied prose' } }) : read(requested), 'typography'),
	/Page content must not duplicate source guidance/);
	for (const invalid of [
		{ ...candidate, sources: null },
		{ ...candidate, sections: null },
		{ ...candidate, guidance: [{ id: 'invalid-source', file: null, heading: 'Introduction' }] },
	]) {
		assert.throws(() => readPage(requested => requested === page ? JSON.stringify(invalid) : read(requested), 'typography'),
			/Invalid book page|Invalid source-section binding/);
	}
});

test('invalid manifests, content shapes, and source bindings fail instead of becoming empty guidance', () => {
	for (const change of [
		value => { value.version = 2; },
		value => { value.topics.push(value.topics[0]); },
		value => { value.topics[0].renderer = '../arbitrary.mjs'; },
		value => { value.topics[0].page = 'content/topics/../../outside.json'; },
		value => { value.defaultTopic = 'unknown'; },
	]) {
		const value = structuredClone(book);
		change(value);
		assert.throws(() => validateBook(value), /Invalid/);
	}
	const pageFile = `${bookRoot}content/topics/typography.json`;
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
	const page = JSON.parse(read(pageFile));
	const inline = typeof page.content === 'object';
	const bodyFile = inline ? pageFile : `${bookRoot}${page.content}`;
	assert.throws(() => readPage(amend(bodyFile, text => {
		const value = JSON.parse(text);
		(inline ? value.content : value).composition = [['fontSize.body1']];
		return JSON.stringify(value);
	}), 'typography'), /Invalid authored chapter/);
	assert.throws(() => readContent(() => '{"version":2}', 'content/legacy.json'), /Invalid book content version/);
	const malformed = structuredClone(curation);
	malformed.productControls[0].groups = [42];
	assert.throws(() => createControls(malformed), /Invalid component curation/);
});

test('Markdown references reject missing, empty, ambiguous, and unsupported selectors', () => {
	const reference = { file: '.github/design-system/typography.design.md', heading: 'Introduction' };
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
	const source = '.github/design-system/motion/examples.md';
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
