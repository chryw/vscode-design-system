/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas tests execute directly in Node. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { catalog, controls, validateBook, createControls, repository } from './repository-helpers.mjs';
import { contentText, sectionContent } from '../view/page-content.mjs';
import { bookRoot, markdownSection, readContent, readPage, readSpecification, resolveContent } from '../adapters/vscode/groups/authored.mjs';
import { load as loadComponent } from '../adapters/vscode/groups/components.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { parseSpecMetadata } from '../runtime/book.mjs';
import { documentControl } from '../adapters/vscode/component-docs.mjs';
import { createRepository } from '../model/repository.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';

const book = repository.projection.book;

const root = workspaceRoot;
const read = file => readFileSync(path.join(root, file), 'utf8');
const amend = (file, transform) => candidate => candidate === file ? transform(read(candidate)) : read(candidate);
const specification = (reader, topic) => readSpecification(reader, topic, repository);
const frontMatter = text => text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)[0];
const legacyTopic = (topic, renderer) => ({ version: 1, topics: [{ section: topic, page: `content/topics/${topic}.json`, renderer }] });
const withFiles = files => requested => Object.hasOwn(files, requested) ? JSON.stringify(files[requested]) : read(requested);

test('every topic is derived from one owning specification and binds to its document', () => {
	const specs = repository.projection.designSpecs;
	const isComponent = spec => ['component', 'composite'].includes(spec.kind);
	const topicFor = spec => isComponent(spec) ? `component-${spec.id}` : spec.id;
	assert.deepEqual({
		title: book.title, defaultTopic: book.defaultTopic,
		topics: catalog.map(topic => topic.id).sort(),
		utilities: catalog.filter(topic => !topic.page).map(topic => topic.id),
		maps: ['topics.json', 'content'].filter(file => existsSync(path.join(root, bookRoot, file))),
	}, {
		title: 'Visual Studio Code Design System', defaultTopic: 'principles',
		topics: [...specs.map(topicFor), 'documentation'].sort(),
		utilities: ['documentation'], maps: [],
	});
	for (const entry of catalog.filter(topic => topic.page)) {
		assert.match(entry.renderer, /^topics\/[a-z]+\.mjs$/);
		const spec = specs.find(spec => topicFor(spec) === entry.id);
		assert.equal(entry.controlId ? entry.design : entry.page, spec.path, entry.id);
	}
	for (const spec of specs.filter(spec => !isComponent(spec) && spec.presentation !== 'motion')) {
		const { page, authored } = specification(read, spec.id);
		assert.deepEqual([page.id, authored.id, typeof authored.intro], [spec.id, spec.id, 'string'], spec.id);
	}
});

test('component topics and aliases derive from component specifications without a second topic inventory', () => {
	const input = structuredClone(repository.projection);
	const first = input.book.topics.findIndex(topic => topic.controlId);
	input.book.components = { after: input.book.topics[first - 1].id };
	input.book.topics = input.book.topics.filter(topic => !topic.controlId);
	const derived = createRepository(input);
	const byId = topics => [...topics].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(derived.projection.book.topics), byId(book.topics));
	input.designSpecs.push({
		id: 'architecture-probe', path: 'src/vs/base/browser/ui/probe/architecture-probe.design.md', title: 'Architecture probe',
		kind: 'component', isDraft: true, aliases: ['probe-alias'], references: [],
		component: { implementation: 'src/vs/base/browser/ui/probe/probe.ts' },
	});
	const probe = createRepository(input);
	assert.deepEqual([probe.getTopic('component-architecture-probe').title, probe.getTopic('component-probe-alias').id,
		probe.topicId({ section: 'components', controlId: 'probe-alias' })],
	['Architecture probe', 'component-architecture-probe', 'component-architecture-probe']);
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
	const original = specification(read, 'typography').authored;
	const file = '.github/skills/design-system/foundations/typography.design.md';
	const introduction = markdownSection(read(file), 'Introduction', file);
	const updated = specification(amend(file, text => text.replace(/\r\n?/g, '\n').replace(introduction, 'Changed guidance from the saved book.')), 'typography').authored;
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
	const source = '.github/skills/design-system/foundations/colors.design.md';
	const reference = { $text: { file: source, heading: 'Preserve component contracts' } };
	assert.ok(resolveContent(reference, amend(source, text => text.replace('- Reserve accent for a leading action.', '- Changed source: reserve accent for a leading action.'))).includes('Changed source:'));
	assert.equal(contentText(updated.baseline, { fontSize: '13px', lineHeight: '1.4em' }),
		'Workbench baseline: 13px text with 1.4em line-height. Individual widgets can override this.');
});

test('authored chapter definitions come from owning front matter without a hand-maintained topic map', () => {
	const file = '.github/skills/design-system/foundations/typography.design.md';
	assert.equal(existsSync(path.join(root, bookRoot, 'topics.json')), false);
	assert.throws(() => specification(amend(file, () => '{broken'), 'typography'), /missing or oversized YAML front matter/);
	assert.throws(() => specification(amend(file, text => text.replace('presentation: "typography"', 'presentation: "guidance"')), 'typography'),
		/identity or presentation changed; reload the checkout/);
});

test('section copy labels the outline, retitles the heading, and consumed copy is not repeated as guidance', () => {
	const file = '.github/skills/design-system/foundations/typography.design.md';
	const label = '  emphasis:\n    label: "Emphasis"\n';
	const withCopy = copy => amend(file, text => text.replace(label, copy)
		.replace('<a id="typography-accessibility"></a>\n', '').replace('<a id="typography-review"></a>\n', ''));
	const project = copy => {
		const { page, authored, sourceSections } = specification(withCopy(copy), 'typography');
		return {
			outline: page.sections.find(section => section.key === 'emphasis').title,
			heading: authored.sections.emphasis.title,
			guidance: sourceSections.map(section => section.title),
		};
	};
	assert.deepEqual([
		project(label),
		project(''),
		project('  emphasis:\n    title: "Choose emphasis"\n'),
		project('  emphasis:\n    label: "Emphasis"\n    description:\n      $text: "Accessibility"\n'),
	], [
		{ outline: 'Emphasis', heading: 'Weight and emphasis', guidance: ['Accessibility', 'Build and review'] },
		{ outline: 'Weight and emphasis', heading: 'Weight and emphasis', guidance: ['Accessibility', 'Build and review'] },
		{ outline: 'Choose emphasis', heading: 'Choose emphasis', guidance: ['Accessibility', 'Build and review'] },
		{ outline: 'Emphasis', heading: 'Weight and emphasis', guidance: ['Build and review'] },
	]);
	for (const field of ['label', 'title']) {
		assert.throws(() => project(`  emphasis:\n    ${field}: " "\n`), new RegExp(`sectionCopy\\.emphasis\\.${field} must be non-empty text`));
	}
});

test('guidance-only chapters project authored sections and saved source edits without viewer copy', () => {
	const file = '.github/skills/design-system/foundations/illustration.design.md';
	const updated = specification(amend(file, text => text.replace(
		markdownSection(read(file), 'Principles', file),
		'Changed illustration guidance.',
	)), 'illustration');
	assert.deepEqual({
		intro: updated.authored.intro,
		sections: updated.sourceSections.map(section => [section.sectionId, section.title, section.source.file]),
		edited: updated.sourceSections.find(section => section.sectionId === 'illustration-principles').markdown.includes('Changed illustration guidance.'),
	}, {
		intro: markdownSection(read(file), 'Introduction', file),
		sections: [
			['illustration-usage', 'Usage', file],
			['illustration-principles', 'Principles', file],
			['illustration-style', 'Visual style', file],
			['illustration-accessibility', 'Accessibility', file],
			['illustration-review', 'Build and review', file],
		],
		edited: true,
	});
});

test('composed chapters accept optional introductions and unheaded lead prose', () => {
	const file = '.github/skills/design-system/foundations/illustration.design.md';
	const body = read(file).slice(read(file).indexOf('## Usage'));
	const original = specification(read, 'illustration');
	const sections = page => page.sourceSections.map(({ sectionId, title, markdown }) => [sectionId, title, markdown]);
	for (const [lead, intro] of [
		['', ''],
		['An unheaded **lead**.\n\n', 'An unheaded **lead**.'],
		['## Introduction\n\nAn explicit lead.\n\n', 'An explicit lead.'],
		['## Introduction\n\n', ''],
		['A preamble.\n\n## Introduction\n\nAn explicit lead.\n\n', 'A preamble.\n\nAn explicit lead.'],
	]) {
		const updated = specification(amend(file, text => `${frontMatter(text)}# Illustration\n\n${lead}${body}`), 'illustration');
		assert.deepEqual({ intro: updated.authored.intro, sections: sections(updated) }, { intro, sections: sections(original) });
	}
});

test('accessibility composes source guidance while legacy pages retain heading order', () => {
	const file = '.github/skills/design-system/foundations/accessibility.design.md';
	const updated = specification(amend(file, text => text.replace(
		'Can someone reach, operate, and leave the surface without a mouse?', 'Changed keyboard guidance.',
	)), 'accessibility');
	const legacyBook = legacyTopic('accessibility', 'guidance');
	const legacyPage = { version: 1, id: 'accessibility', renderer: 'guidance', sources: [], sections: [], content: 'content/accessibility.json' };
	const legacyContent = { version: 1, id: 'accessibility', status: 'book-authored', intro: '', sections: {}, headingOrder: ['Keyboard Navigation'] };
	const legacyRead = (page, content = legacyContent) => withFiles({
		[`${bookRoot}content/topics/accessibility.json`]: page, [`${bookRoot}content/accessibility.json`]: content,
	});
	const legacy = readPage(legacyRead(legacyPage), 'accessibility', legacyBook);
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
	assert.throws(() => readPage(legacyRead({ ...legacyPage, guidance: [{ id: 'accessibility-keyboard', file, heading: 'Missing keyboard guidance' }] }),
		'accessibility', legacyBook), /Missing keyboard guidance/);
	const { headingOrder, ...unordered } = legacyContent;
	assert.throws(() => readPage(legacyRead(legacyPage, unordered), 'accessibility', legacyBook), /Invalid authored chapter: accessibility/);
});

test('elevation guidance and scenario captions come from the owning document and reject incomplete composition', () => {
	const file = '.github/skills/design-system/foundations/elevation.design.md';
	const updated = specification(amend(file, text => text.replace(
		'The editor leads; navigation and tools support it without becoming independent floating layers.',
		'Changed relationship caption.',
	)), 'elevation').authored;
	assert.match(updated.scenarios[0].caption, /Changed relationship caption/);
	assert.equal(updated.markdownSource, file);
	assert.doesNotMatch(read(file), /Lessons from other systems|atlassian\.design|fluent2\.microsoft\.design|storybooks\.fluentui\.dev|learn\.microsoft\.com\/en-us\/windows\/apps\/design/i);
	const edited = specification(amend(file, text => text
		.replace('These are implemented treatments, not a requirement to make every surface look identical.', 'Changed consumer guidance.')
		.replace('Keep validation and recoverable errors in the current dialog.', 'Changed modal guidance.')
		.replace('The numbered cues pair', 'Changed construction caption.')
		.replace("Pair the component's background and foreground", 'Changed fill guidance.')
		.replace('Both overlays extend beyond a scroll container;', 'Changed hosting caption.')), 'elevation').authored;
	assert.deepEqual({
		consumerGuidance: edited.sections.shadows.paragraphs.some(text => text.includes('Changed consumer guidance.')),
		modalGuidance: edited.sections.role.paragraphs.some(text => text.includes('Changed modal guidance.')),
		constructionCaption: edited.construction.caption.startsWith('Changed construction caption.'),
		fillGuidance: edited.construction.parts[0].description.startsWith('Changed fill guidance.'),
		hostingCaption: edited.hosting.caption.startsWith('Changed hosting caption.'),
	}, { consumerGuidance: true, modalGuidance: true, constructionCaption: true, fillGuidance: true, hostingCaption: true });
	for (const [from, to] of [
		['id: "navigation"', 'id: "unsupported"'],
		['      caption:\n        $text: "Inspection relationship"\n', ''],
		['    caption:\n      $text: "Surface construction study"\n', ''],
		['  hosting:', '  hostingX:'],
		['id: "lg"', 'id: "invented-shadow"'],
	]) {
		assert.ok(read(file).includes(from), from);
		assert.throws(() => specification(amend(file, text => text.replace(from, to)), 'elevation'), /Invalid authored chapter: elevation/, from);
	}
});

test('a saved authored edit invalidates only its dependent topic and refresh rereads its Markdown', { timeout: 10000 }, async () => {
	const file = '.github/skills/design-system/foundations/typography.design.md';
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
		writeFileSync(scratch, original.replace('<a id="typography-composition"></a>\n', ''));
		await assert.rejects(store.read('typography', { theme: 'Dark 2026' }), /Invalid authored chapter: typography/);
	} finally {
		store.close();
		rmSync(scratch, { force: true });
	}
});

test('Button reads its design document and derives API declarations without reference JSON', () => {
	const file = 'src/vs/base/browser/ui/button/button.design.md';
	const changed = loadComponent({ root, repository, read: amend(file, text => text.replace('Runs actions through', 'Changed component note: runs actions through')) }, 'button').controls[0];
	assert.ok(changed.docs.summary.startsWith('Changed component note:'));
	assert.ok(changed.docs.api.every(member => member.source.file === 'src/vs/base/browser/ui/button/button.ts' && member.source.line > 0));
	const owner = 'src/vs/base/browser/ui/button/button.ts';
	const derived = loadComponent({ root, repository, read: file => {
		if (file === `${bookRoot}content/components/references/button.json`) { throw new Error('Legacy Button reference must not be read'); }
		return file === owner ? read(file).replace('set label(value: string | IMarkdownString);', 'set label(value: number);') : read(file);
	} }, 'button').controls[0];
	assert.deepEqual({
		className: derived.docs.className, apiSource: derived.docs.apiSource,
		label: derived.docs.api.find(member => member.symbol === 'IButton.label'),
		secondary: derived.docs.api.find(member => member.symbol === 'IButtonOptions.secondary').optional,
	}, {
		className: 'Button', apiSource: 'typescript',
		label: { name: 'label', type: 'number', optional: false, declaration: 'set label(value: number);', symbol: 'IButton.label', source: { file: owner, line: 71 } },
		secondary: true,
	});
	assert.throws(() => loadComponent({ root, repository, read: amend(owner, text => text.replace('set label(value: string | IMarkdownString);', 'set renamedLabel(value: string | IMarkdownString);')) }, 'button'),
		/Expected one public component API member IButton.label/);
	assert.throws(() => loadComponent({ root, repository, read: amend(file, text => text.replace('## Usage', '## Missing usage')) }, 'button'), /Expected one section "Usage"/);
});

test('Button preserves Markdown structure and rejects invalid API selectors and sources', () => {
	const file = 'src/vs/base/browser/ui/button/button.design.md';
	const edited = loadComponent({ root, repository, read: amend(file, text => text.replace(
		'- Use a clear verb for the action.',
		'- Use a clear verb for the action.\n  - Keep `onDidClick` as the activation owner.',
	)) }, 'button').controls[0];
	assert.match(edited.docs.design.markdown, /  - Keep `onDidClick`/);
	for (const [from, to] of [
		['    - "IButton.label"\n', '    - "IButton.label"\n    - "IButton.label"\n'],
		['implementation: "src/vs/base/browser/ui/button/button.ts"', 'implementation: "../outside.ts"'],
		['    - "IButton.label"\n', '    - "IButton.label.value"\n'],
		['  fixtures:', '  examples:'],
	]) {
		assert.ok(read(file).includes(from), from);
		assert.throws(() => parseSpecMetadata(read(file).replace(from, to), file, 'component'), /Invalid component specification bindings/, to);
	}
	const button = controls.find(control => control.id === 'button');
	for (const api of [['ButtonBar._buttons'], ['IButton.missing']]) {
		assert.throws(() => documentControl({ ...button, api }, read, undefined, root),
			/Unsupported public component API|Expected one public component API/);
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

test('component source parsing uses session tooling without executing selected checkout dependencies', t => {
	const fixture = createDocumentCheckout(t);
	fixture.write('node_modules/typescript/package.json', '{"name":"typescript","main":"index.js"}');
	fixture.write('node_modules/typescript/index.js', 'throw new Error("Selected dependency must not execute");\n');
	const button = controls.find(control => control.id === 'button');
	const api = documentControl({ ...button, api: ['IButton.label'] }, read, undefined, fixture.root).docs.api;
	assert.deepEqual(api.map(({ symbol, type, source }) => ({ symbol, type, file: source.file })), [{
		symbol: 'IButton.label', type: 'string | IMarkdownString', file: 'src/vs/base/browser/ui/button/button.ts',
	}]);
});

test('legacy inline chapter composition reads complete source sections without paragraph projections', () => {
	const file = '.github/skills/design-system/foundations/typography.design.md';
	const page = `${bookRoot}content/topics/typography.json`;
	const legacyBook = legacyTopic('typography', 'typography');
	const original = specification(read, 'typography').authored;
	const candidate = {
		version: 1, id: 'typography', renderer: 'typography', source: file, sources: [],
		content: { sampleText: original.sampleText, baseline: original.baseline, composition: original.composition },
		sections: Object.entries(original.sections).map(([key, section]) => ({
			id: `typography-${key}`, key, heading: section.title,
		})),
	};
	const projection = readPage(requested => requested === page ? JSON.stringify(candidate) : requested === file
		? read(file).replace('## Hierarchy and reading rhythm', '## Hierarchy and reading rhythm\n\nAdditional paragraph from the owner.')
		: read(requested), 'typography', legacyBook);
	assert.deepEqual({
		text: projection.authored.sections.composition.description,
		paragraphSelectors: projection.authored.sections.composition.paragraphs,
		primary: projection.authored.markdownSource,
	}, {
		text: `Additional paragraph from the owner.\n\n${markdownSection(read(file), 'Hierarchy and reading rhythm', file)}`,
		paragraphSelectors: [], primary: file,
	});
	assert.throws(() => readPage(withFiles({ [page]: { ...candidate, content: { ...candidate.content, intro: 'Copied prose' } } }), 'typography', legacyBook),
		/Page content must not duplicate source guidance/);
	for (const invalid of [
		{ ...candidate, sources: null },
		{ ...candidate, sections: null },
		{ ...candidate, guidance: [{ id: 'invalid-source', file: null, heading: 'Introduction' }] },
	]) {
		assert.throws(() => readPage(withFiles({ [page]: invalid }), 'typography', legacyBook),
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
	const file = '.github/skills/design-system/foundations/typography.design.md';
	for (const [from, to, expected] of [
		['      - "Metadata badge · label3"\n', '', /Invalid authored chapter: typography/],
		['  sampleText:', '  sampleTextX:', /Invalid authored chapter: typography/],
		['$text: "Hierarchy in practice"', '$text: "Missing source section"', /Expected one section/],
		['$text: "Hierarchy in practice"', '$unknown: "Hierarchy in practice"', /Unsupported book content binding/],
	]) {
		assert.ok(read(file).includes(from), from);
		assert.throws(() => specification(amend(file, text => text.replace(from, to)), 'typography'), expected, to);
	}
	assert.throws(() => readContent(() => '{"version":2}', 'content/legacy.json'), /Invalid book content version/);
	assert.throws(() => createControls({ version: 1, productControls: [{ id: 'probe', name: 'Probe', groups: [42] }], families: [], additions: [] }),
		/Invalid component curation/);
});

test('Markdown references reject missing, empty, ambiguous, and unsupported selectors', () => {
	const reference = { file: '.github/skills/design-system/foundations/typography.design.md', heading: 'Introduction' };
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
	const source = '.github/skills/design-system/foundations/example.md';
	const text = '# Examples\n\n## Foundations\n\nExplain the relationship.\n\n## Selection caption\n\nThe selection indicator connects the states.\n';
	const read = file => {
		assert.equal(file, source);
		return text;
	};
	const reference = { description: { $text: 'Foundations' }, caption: { $text: 'Selection caption' } };
	const resolved = resolveContent(reference, read, { source });
	assert.deepEqual(resolved, {
		description: markdownSection(read(source), 'Foundations', source),
		caption: markdownSection(read(source), 'Selection caption', source),
	});
	assert.match(resolveContent(reference, () => text.replace(
		'The selection indicator connects',
		'Changed source caption connects',
	), { source }).caption, /^Changed source caption/);
	assert.throws(() => resolveContent(reference, read), /Invalid Markdown content reference/);
	assert.throws(() => resolveContent(reference, read, { source: '../outside.md' }), /Invalid book source reference/);
	assert.throws(() => resolveContent({ $text: 'Missing source section' }, read, { source }), /Expected one section/);
	assert.throws(() => resolveContent(reference, () => `${text}\n## Foundations\n\nDuplicate.\n`, { source }), /found 2/);
});
