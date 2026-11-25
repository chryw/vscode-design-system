/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build book discovery contract tests. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { basicProjection } from '../adapters/vscode/basic-book.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { createRepository } from '../model/repository.mjs';
import { legacyRepositoryDirectory, readGeneratedBook, repositoryDirectory, repositoryDirectoryFor } from '../runtime/book.mjs';
import { DocumentLibrary } from '../runtime/documents.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { defaultView } from '../runtime/view-state.mjs';
import { topicPresentation } from '../view/navigation-model.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { vscodeAdapter } from '../adapters/vscode/readers.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';
import { readSpecification } from '../adapters/vscode/groups/authored.mjs';
import { readDefaultPalettes } from '../adapters/vscode/theme-palettes.mjs';
import { fixtureFilesFor } from '../adapters/vscode/fixtures.mjs';
import { hasRichMotion } from './motion-helpers.mjs';

const movedDocuments = 'content/legacy-document-paths.json';
const colorsSpec = `${repositoryDirectory}/foundations/colors.design.md`;

/** Copies the checkout's guidance without moved-path metadata, so the result does not depend on the checkout under test. */
function canonicalCheckout(t) {
	const fixture = createDocumentCheckout(t);
	rmSync(path.join(fixture.bookRoot, movedDocuments), { force: true });
	for (const directory of ['foundations', 'patterns']) {
		for (const name of readdirSync(path.join(fixture.bookRoot, directory), { recursive: true })) {
			if (!name.endsWith('.design.md')) { continue; }
			const file = path.join(fixture.bookRoot, directory, name);
			writeFileSync(file, readFileSync(file, 'utf8').replace(/^legacyPaths:.*\r?\n(?:[ \t]+-.*\r?\n)*/m, ''));
		}
	}
	return fixture;
}

test('the current catalog is derived from shared and code-local specification front matter', () => {
	const result = readGeneratedBook(workspaceRoot);
	assert.ok(result);
	const shared = result.specs.filter(spec => ['foundation', 'pattern'].includes(spec.kind));
	const components = result.specs.filter(spec => spec.kind === 'component');
	assert.ok(shared.length > 0);
	assert.ok(components.length > 0);
	assert.ok(shared.every(spec => spec.path.startsWith(`${repositoryDirectory}/`)));
	assert.ok(components.every(spec => spec.path.startsWith('src/vs/')));
	assert.deepEqual(result.book.topics.filter(topic => topic.group === 'Foundations' || topic.group === 'Patterns').map(({ id, isDraft }) => ({ id, isDraft })),
		shared.map(({ id, isDraft }) => ({ id, isDraft })));
	assert.equal(result.book.components.page, undefined);
});

test('component articles and the source library need no placeholder reference documents', async t => {
	const fixture = canonicalCheckout(t);
	const placeholders = ['component-overview.md', 'component-qualification.md', 'document-library.md'];
	for (const file of placeholders) {
		rmSync(path.join(fixture.bookRoot, 'references', file), { force: true });
	}
	const file = 'src/vs/base/browser/ui/example/example.design.md';
	fixture.write(file, '---\ntitle: "Example"\nkind: "component"\nisDraft: true\n---\n# Example\n\n## Overview\nThe owning component contract.\n\n## Usage\n- Use for the documented task.\n\n## Accessibility\n- Preserve keyboard operation.\n\n## Preview\nNo fixture is bound.\n');
	const store = new TopicStore(fixture.root);
	try {
		const component = await store.read('component-example', defaultView('component-example', store.repository));
		const library = await store.read('documentation', defaultView('documentation', store.repository));
		assert.deepEqual({
			page: store.repository.getTopic('component-example').page,
			source: topicPresentation(component.data, component.data.view).source.file,
			summary: component.data.controls[0].docs.summary,
			documentsFound: library.data.library.listing.results.length > 0,
			placeholderDependencies: [...component.data.sourceFiles, ...library.data.sourceFiles]
				.filter(file => placeholders.some(name => file.endsWith(`/references/${name}`))),
		}, {
			page: file,
			source: file,
			summary: 'The owning component contract.',
			documentsFound: true,
			placeholderDependencies: [],
		});
	} finally { store.close(); }
});

test('component specification lifecycle needs no curation or toolkit inventory', async t => {
	const fixture = canonicalCheckout(t);
	for (const file of ['curation.json', 'toolkit-specifications.json']) {
		rmSync(path.join(fixture.bookRoot, 'content/components', file), { force: true });
	}
	const file = 'src/vs/base/browser/ui/example/example.design.md';
	const document = (title, extra = '') => `---\ntitle: "${title}"\nkind: "component"\nisDraft: true\n${extra}---\n# ${title}\n\n## Overview\nA composed control.\n\n## Usage\n- Keep its contents together.\n\n## Accessibility\n- Preserve keyboard access.\n\n## Preview\nNo live example is declared.\n`;
	fixture.write(file, document('Example'));
	const observe = () => readRepository(fixture.root).catalog.filter(topic => topic.group === 'Components')
		.map(({ id, title, kind, isDraft, fixture }) => ({ id, title, kind, isDraft, fixture }));
	const added = observe();
	fixture.write(file, document('Revised example'));
	const edited = observe();
	const renamed = 'src/vs/base/browser/ui/example/renamed.design.md';
	renameSync(path.join(fixture.root, file), path.join(fixture.root, renamed));
	fixture.write(renamed, document('Revised example', 'id: "example"\n'));
	const moved = observe();
	const store = new TopicStore(fixture.root);
	try {
		const result = await store.read('component-example', defaultView('component-example', store.repository));
		assert.equal(result.data.controls[0].docs.summary, 'A composed control.');
	} finally { store.close(); }
	rmSync(path.join(fixture.root, renamed));
	assert.deepEqual({ added, edited, moved, removed: observe() }, {
		added: [{ id: 'component-example', title: 'Example', kind: 'component', isDraft: true, fixture: false }],
		edited: [{ id: 'component-example', title: 'Revised example', kind: 'component', isDraft: true, fixture: false }],
		moved: [{ id: 'component-example', title: 'Revised example', kind: 'component', isDraft: true, fixture: false }],
		removed: [],
	});
});

test('deprecated specifications redirect to replacements of another kind', t => {
	const fixture = canonicalCheckout(t);
	const component = (title, extra) => `---\ntitle: "${title}"\nkind: "component"\n${extra}---\n# ${title}\n\n## Overview\nA composed control.\n`;
	fixture.write('src/vs/base/browser/ui/example/example.design.md', component('Example', 'isDraft: true\n'));
	fixture.write('src/vs/base/browser/ui/example/old-example.design.md',
		component('Old example', 'replacedBy: "modal"\naliases:\n  - "example-v1"\n'));
	fixture.write(`${repositoryDirectory}/foundations/flow.design.md`,
		'---\ntitle: "Flow"\nkind: "foundation"\nreplacedBy: "example"\n---\n# Flow\n\nUse the example.\n');
	const repository = readRepository(fixture.root);
	assert.deepEqual(['flow', 'component-old-example', 'component-example-v1'].map(id => repository.getTopic(id).id),
		['component-example', 'modal', 'modal']);
});

test('component discovery and flat navigation follow front matter independently of fixture metadata or availability', t => {
	const fixture = canonicalCheckout(t);
	const file = id => `src/vs/base/browser/ui/${id}/${id}.design.md`;
	const spec = (id, groups) => fixture.write(file(id),
		`---\ntitle: "${id}"\nkind: "component"\nisDraft: true\ncomponent:\n  fixtures: ${JSON.stringify(groups)}\n---\n# ${id}\n`);
	spec('control', ['unavailable/Control']);
	spec('composed', []);
	const example = 'src/vs/test/feature.fixture.ts';
	fixture.write(example, 'export default defineThemedFixtureGroup({ labels: { primitive: true } }, {});');
	const observe = () => {
		const repository = readRepository(fixture.root);
		return repository.controls.map(control => [control.id, control.kind, control.primitive, repository.getTopic(`component-${control.id}`).subgroup]);
	};
	const before = observe();
	fixture.write(example, 'This unavailable fixture cannot be parsed or executed.');
	const during = observe();
	rmSync(path.join(fixture.root, example));
	const after = observe();
	rmSync(path.join(fixture.root, file('composed')));
	const expected = [['composed', 'component', true, undefined], ['control', 'component', true, undefined]];
	assert.deepEqual({ before, during, after, removed: observe() }, {
		before: expected, during: expected, after: expected, removed: [expected[1]],
	});
});

test('draft flags are boolean and omitted flags leave guidance unmarked', t => {
	const fixture = canonicalCheckout(t);
	const file = 'src/vs/base/browser/ui/example/example.design.md';
	const write = extra => fixture.write(file, `---\ntitle: "Example"\nkind: "component"\n${extra}---\n# Example\n`);
	const states = ['', 'isDraft: false\n', 'isDraft: true\n'].map(extra => {
		write(extra);
		const topic = readRepository(fixture.root).getTopic('component-example');
		return { isDraft: topic.isDraft, hidden: topic.hidden, status: Object.hasOwn(topic, 'status') };
	});
	assert.deepEqual(states, [
		{ isDraft: false, hidden: false, status: false },
		{ isDraft: false, hidden: false, status: false },
		{ isDraft: true, hidden: false, status: false },
	]);
	for (const extra of ['isDraft: "true"\n', 'isDraft: null\n', 'isDraft: true\nstatus: draft\n', 'isDraft: true\nreplacedBy: modal\n']) {
		write(extra);
		assert.throws(() => readRepository(fixture.root), /invalid design specification metadata/);
	}
});

test('historical kinds and statuses normalize without losing draft visibility or redirects', t => {
	const fixture = canonicalCheckout(t);
	const spec = (id, kind, status, extra = '') => fixture.write(`src/vs/base/browser/ui/${id}/${id}.design.md`,
		`---\ntitle: "${id}"\nkind: "${kind}"\nstatus: "${status}"\n${extra}---\n# ${id}\n`);
	spec('control', 'primitive', 'draft');
	spec('composed', 'composite', 'stable');
	spec('old', 'primitive', 'deprecated', 'replacedBy: control\naliases: [old-control]\n');
	const repository = readRepository(fixture.root);
	assert.deepEqual({
		topics: repository.catalog.filter(topic => topic.group === 'Components' && !topic.hidden)
			.map(({ id, kind, isDraft, subgroup }) => ({ id, kind, isDraft, subgroup })),
		redirect: repository.getTopic('component-old-control').id,
	}, {
		topics: [
			{ id: 'component-composed', kind: 'component', isDraft: false, subgroup: undefined },
			{ id: 'component-control', kind: 'component', isDraft: true, subgroup: undefined },
		],
		redirect: 'component-control',
	});
});

test('a foundation is readable with only its Markdown and no content registrations', async t => {
	const fixture = canonicalCheckout(t);
	rmSync(path.join(fixture.bookRoot, 'content'), { recursive: true, force: true });
	fixture.write(`${repositoryDirectory}/foundations/flow.design.md`,
		'---\ntitle: "Flow"\nkind: "foundation"\nisDraft: true\n---\n# Flow\n\n## Choose a direction\nKeep the next action clear.\n');
	const store = new TopicStore(fixture.root);
	try {
		const result = await store.read('flow', defaultView('flow', store.repository));
		assert.deepEqual({
			mode: store.repository.projection.mode,
			title: store.repository.getTopic('flow').title,
			generic: result.data.genericGuidance,
			content: result.data.sourceSections.map(({ title, markdown }) => ({ title, markdown })),
		}, {
			mode: 'authored', title: 'Flow', generic: true,
			content: [{ title: 'Choose a direction', markdown: 'Keep the next action clear.' }],
		});
	} finally { store.close(); }
});

test('a guidance-only Motion chapter reads without runtime motion definitions', async t => {
	const fixture = canonicalCheckout(t);
	fixture.write(`${repositoryDirectory}/foundations/motion.design.md`,
		'---\ntitle: "Motion"\nkind: "foundation"\nisDraft: true\n---\n# Motion\n\n## Define intent\nMove only to explain a change.\n');
	const store = new TopicStore(fixture.root);
	try {
		const result = await store.read('motion', defaultView('motion', store.repository));
		assert.deepEqual({
			generic: result.data.genericGuidance,
			content: result.data.sourceSections.map(({ title, markdown }) => ({ title, markdown })),
			definitions: result.data.resources.definitions,
		}, {
			generic: true,
			content: [{ title: 'Define intent', markdown: 'Move only to explain a change.' }],
			definitions: [],
		});
	} finally { store.close(); }
});

test('a rich chapter derives section identities, copy, and order from its owning headings and saved front matter', t => {
	const fixture = canonicalCheckout(t);
	const file = `${repositoryDirectory}/foundations/shape.design.md`;
	const text = `---
title: Geometry
kind: foundation
isDraft: true
presentation: foundations
specimens:
  contexts:
    - kind: control
      token: cornerRadius.small
      label:
        $text: Caption
---
# Geometry

An introduction.

<a id="shape-roles"></a>
<a id="shape-guidance"></a>
## Choose geometry

Use the surface role.

<a id="shape-scale"></a>
## Registered scale

Read current code.

## Caption

A text field

## Review

Check the receiving surface.
`;
	fixture.write(file, text);
	const read = file => {
		assert.ok(!file.endsWith('.json'), 'A chapter must not read a companion registration');
		return readFileSync(path.join(fixture.root, file), 'utf8');
	};
	const repository = readRepository(fixture.root);
	const first = readSpecification(read, 'shape', repository);
	fixture.write(file, text.replace('## Choose geometry', '## Choose by role').replace('label:\n        $text: Caption', 'label: Saved label'));
	const revised = readSpecification(read, 'shape', repository);
	assert.deepEqual({
		sections: first.page.sections.map(({ id, key, title, aliases }) => ({ id, key, title, aliases })),
		copy: first.authored.sections.roles.description,
		example: first.authored.contexts[0].label,
		guidance: first.sourceSections.map(section => section.title),
		revised: revised.authored.sections.roles.title,
		revisedExample: revised.authored.contexts[0].label,
	}, {
		sections: [
			{ id: 'shape-roles', key: 'roles', title: 'Choose geometry', aliases: ['shape-guidance'] },
			{ id: 'shape-scale', key: 'scale', title: 'Registered scale', aliases: [] },
			{ id: 'shape-review', key: undefined, title: 'Review', aliases: undefined },
		],
		copy: 'Use the surface role.', example: 'A text field', guidance: ['Review'], revised: 'Choose by role',
		revisedExample: 'Saved label',
	});
});

test('live Motion examples bind real fixtures from the owning specification without a binding inventory',
	{ skip: hasRichMotion ? false : 'The selected checkout declares no Motion fixtures' }, t => {
	const fixture = canonicalCheckout(t);
	for (const file of ['curation.json', 'fixture-bindings.json']) {
		rmSync(path.join(fixture.bookRoot, 'content/components', file), { force: true });
	}
	const workbench = 'src/vs/workbench/test/browser/componentFixtures/motion.fixture.ts';
	const sessions = 'src/vs/sessions/contrib/sessions/test/browser/motionSessions.fixture.ts';
	const control = (id, group, file, name = group.split('/').at(-1)) => ({ id: `motion-${id}`, name, groups: [group], file });
	const { motionControls } = readRepository(fixture.root);
	assert.deepEqual({
		controls: motionControls.map(({ id, name, groups, file }) => ({ id, name, groups, file })),
		files: fixtureFilesFor(workspaceRoot, motionControls),
	}, {
		controls: [
			control('selection', 'motion/Selection', workbench), control('anchored-menu', 'motion/AnchoredMenu', workbench),
			control('disclosure', 'motion/Disclosure', workbench), control('delayed-content', 'motion/DelayedContent', workbench),
			control('agent-activity', 'motion/AgentActivity', workbench), control('progress', 'motion/Progress', workbench),
			control('notification', 'motion/Notification', workbench),
			control('completion', 'sessions/motionSessions/MotionCommit', sessions, 'Completion'),
		],
		files: [workbench, sessions],
	});
	const spec = path.join(fixture.bookRoot, 'foundations/motion.design.md');
	writeFileSync(spec, readFileSync(spec, 'utf8').replace(`file: "${sessions}"`, 'file: "src/../outside.fixture.ts"'));
	assert.throws(() => readRepository(fixture.root), /Invalid Motion example fixture binding: completion/);
});

test('palette identities follow product theme defaults instead of a documentation inventory', () => {
	const source = `export namespace ThemeSettingDefaults {
	export const COLOR_THEME_LIGHT = 'Current light';
	export const COLOR_THEME_DARK = 'Current dark';
	export const COLOR_THEME_HC_LIGHT = 'Current contrast light';
	export const COLOR_THEME_HC_DARK = 'Current contrast dark';
}`;
	assert.deepEqual(readDefaultPalettes(source), [
		{ id: 'Current light', label: 'Light' }, { id: 'Current dark', label: 'Dark' },
		{ id: 'Current contrast dark', label: 'High contrast dark' }, { id: 'Current contrast light', label: 'High contrast light' },
	]);
	assert.throws(() => readDefaultPalettes(source.replace('COLOR_THEME_LIGHT', 'REMOVED_THEME')), /default theme settings changed/);
});

test('Colors points to its owning specification and retains the product source link', async () => {
	const store = new TopicStore(workspaceRoot);
	try {
		const result = await store.read('colors', defaultView('colors', store.repository));
		assert.equal(result.data.primarySourceDocument.id, '.github/skills/design-system/foundations/colors.design.md');
		assert.ok(result.sources.includes('src/vs/platform/theme/common/colors/baseColors.ts'));
	} finally {
		store.close();
	}
});

test('generated chapters with live component examples can request the fixture renderer', async t => {
	const adapter = { ...vscodeAdapter, loadFixtureCatalog: async () => ({ sourceTreeId: 'tree', fixtures: [] }) };
	const panel = await createExplorer(workspaceRoot, { adapter, watchCheckout: false, scope: { operation: 'all', active: 'principles' } });
	t.after(() => panel.close());
	const statuses = {};
	for (const topic of ['principles', 'colors', 'spacing', 'motion']) {
		panel.setScope({ operation: 'all', active: topic });
		statuses[topic] = (await fetch(new URL('/api/fixtures', panel.url))).status;
	}
	assert.deepEqual(statuses, { principles: 500, colors: 200, spacing: 200, motion: hasRichMotion ? 200 : 500 });
});

test('canonical checkouts load without moved-path metadata and do not resolve moved paths', t => {
	const fixture = canonicalCheckout(t);
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		assert.deepEqual({
			documentAliases: readGeneratedBook(fixture.root).book.documentAliases,
			read: library.read(colorsSpec).id,
			diagnostics: library.snapshot().diagnostics,
		}, { documentAliases: {}, read: colorsSpec, diagnostics: [] });
		assert.throws(() => library.read('.github/design-system/colors.design.md'), /not available/);
	} finally { library.close(); }
});

test('removing the redundant expectations inventory preserves catalog and view defaults', t => {
	const fixture = canonicalCheckout(t);
	const inventory = path.join(fixture.bookRoot, 'content/foundations/reference-expectations.json');
	const expectations = { structures: { motion: ['Obsolete heading'] }, capabilities: { motion: ['Obsolete capability'] } };
	mkdirSync(path.dirname(inventory), { recursive: true });
	writeFileSync(inventory, JSON.stringify(expectations));
	const older = readRepository(fixture.root);
	rmSync(inventory);
	const current = readRepository(fixture.root);
	const snapshot = createRepository({ ...current.projection, expectations });
	const observe = repository => ({
		catalog: repository.catalog,
		controls: repository.controls,
		views: repository.catalog.filter(topic => !topic.hidden).map(topic => defaultView(topic.id, repository)),
	});
	assert.deepEqual([observe(current), observe(snapshot)], [observe(older), observe(older)]);
});

test('older checkouts that declare moved paths keep chapter and document links on canonical guidance', t => {
	const fixture = canonicalCheckout(t);
	const inputBoxSpec = 'src/vs/base/browser/ui/inputbox/input-box.design.md';
	const movedChapters = [
		['colors', colorsSpec, ['.github/design-system/colors.design.md', 'src/vs/platform/theme/common/colors/COLORS.md']],
		['typography', `${repositoryDirectory}/foundations/typography.design.md`, ['src/vs/platform/theme/common/sizes/typography.md', 'src/vs/platform/theme/common/sizes/typography.design.md']],
		['modal', `${repositoryDirectory}/patterns/modal.design.md`, ['.github/design-system/guidance/modal.design.md']],
	];
	const movedInputBox = ['src/vs/base/browser/ui/inputbox/input-design.md', 'src/vs/base/browser/ui/inputbox/input.design.md'];
	const movedEntry = '.github/design-system/README.md';
	const entry = `${repositoryDirectory}/SKILL.md`;
	const declareMovedPaths = (file, paths) => {
		const spec = path.join(fixture.root, file);
		writeFileSync(spec, readFileSync(spec, 'utf8').replace(/\r?\n---\r?\n/, `\nlegacyPaths:\n${paths.map(item => `  - "${item}"`).join('\n')}\n---\n`));
	};
	fixture.write(inputBoxSpec, readFileSync(path.join(workspaceRoot, inputBoxSpec), 'utf8'));
	for (const file of fixtureFilesFor(workspaceRoot, [{ id: 'input-box', groups: ['baseUI/InputBoxes'] }])) {
		fixture.write(file, readFileSync(path.join(workspaceRoot, file), 'utf8'));
	}
	for (const [, file, paths] of movedChapters) { declareMovedPaths(file, paths); }
	declareMovedPaths(inputBoxSpec, movedInputBox);
	mkdirSync(path.join(fixture.bookRoot, 'content'), { recursive: true });
	writeFileSync(path.join(fixture.bookRoot, movedDocuments), JSON.stringify({ [movedEntry]: entry }));
	const repository = readRepository(fixture.root);
	const library = new DocumentLibrary(fixture.root, { bookRoot: fixture.bookRoot });
	try {
		const movedDocumentPairs = [
			...movedChapters.flatMap(([, file, paths]) => paths.map(item => [item, file])),
			...movedInputBox.map(item => [item, inputBoxSpec]),
			[movedEntry, entry],
		];
		assert.deepEqual({
			topics: movedChapters.flatMap(([, , paths]) => paths.map(item => repository.getTopic(item).id)),
			documents: movedDocumentPairs.map(([item]) => library.read(item).id),
			componentSources: movedInputBox.map(item => [library.read(item).source.file, library.read(item).title]),
			diagnostics: library.snapshot().diagnostics,
		}, {
			topics: movedChapters.flatMap(([id, , paths]) => paths.map(() => id)),
			documents: movedDocumentPairs.map(([, file]) => file),
			componentSources: movedInputBox.map(() => [inputBoxSpec, 'InputBox']),
			diagnostics: [],
		});
	} finally { library.close(); }
	writeFileSync(path.join(fixture.bookRoot, movedDocuments), '{');
	assert.throws(() => readGeneratedBook(fixture.root), SyntaxError);
});

test('legacy checkouts remain selectable and generated content paths resolve inside their legacy root', t => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'design-book-legacy-root-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(path.join(root, 'src/vs/base/common'), { recursive: true });
	writeFileSync(path.join(root, 'src/vs/base/common/lifecycle.ts'), '');
	const legacyRoot = path.join(root, legacyRepositoryDirectory);
	mkdirSync(legacyRoot, { recursive: true });
	assert.equal(repositoryDirectoryFor(root), legacyRoot);
	mkdirSync(path.join(root, repositoryDirectory, 'foundations'), { recursive: true });
	assert.equal(repositoryDirectoryFor(root), path.join(root, repositoryDirectory));

	const store = new TopicStore(root, { bookRoot: legacyRoot, repository: basicProjection() });
	try {
		assert.equal(store.sourcePath(`${repositoryDirectory}/content/topics/colors.json`),
			path.join(legacyRoot, 'content/topics/colors.json'));
	} finally {
		store.close();
	}
});
