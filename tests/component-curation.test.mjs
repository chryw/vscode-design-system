/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { controls, catalog, getTopic, repository, topicId, validateScope } from './repository-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { curateFixtures } from '../model/components.mjs';
import { createRepository } from '../model/repository.mjs';

const root = workspaceRoot;
const visible = controls.filter(control => !control.hidden);
/** Reads component front matter directly from tracked specifications, independently of the viewer's discovery. */
const componentSpecs = execFileSync('git', ['ls-files', 'src/**/*.design.md'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).flatMap(file => {
	const frontMatter = readFileSync(`${root}/${file}`, 'utf8').match(/^---\n(?<yaml>[\s\S]*?)\n---/)?.groups.yaml ?? '';
	const field = name => frontMatter.match(new RegExp(`^${name}: "(?<value>[^"]+)"`, 'm'))?.groups.value;
	const kind = field('kind');
	return kind === 'component' ? [{ file, kind, id: field('id') ?? file.split('/').at(-1).replace(/\.design\.md$/, '') }] : [];
});

test('component topics are exactly the discovered component specifications', () => {
	assert.ok(componentSpecs.length > 0);
	assert.deepEqual(visible.map(control => control.id).sort(), componentSpecs.map(spec => spec.id).sort());
	assert.equal(new Set(controls.map(control => control.id)).size, controls.length);
	assert.deepEqual(visible.map(control => control.name), visible.map(control => control.name).sort((a, b) => a.localeCompare(b, 'en')));
	for (const spec of componentSpecs) {
		const topic = getTopic(`component-${spec.id}`);
		assert.deepEqual({ design: topic.design, kind: topic.kind }, { design: spec.file, kind: spec.kind }, spec.id);
	}
	assert.equal(catalog.some(topic => topic.id === 'components'), false);
	assert.equal(visible.every(control => !('family' in control)), true);
	const listed = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/book.mjs', import.meta.url)), 'list', '--root', root], { cwd: root, encoding: 'utf8' }));
	assert.deepEqual(listed.topics.map(topic => topic.id), catalog.filter(topic => !topic.hidden).map(topic => topic.id));
});

test('specification metadata drives readiness and component grouping independently of fixtures', () => {
	assert.ok(catalog.some(topic => topic.isDraft && !topic.hidden));
	const withoutFixtures = visible.filter(control => control.groups.length === 0);
	assert.ok(withoutFixtures.length > 0, 'a specification without fixtures still owns a topic');
	for (const control of withoutFixtures) {
		assert.deepEqual({ fixture: getTopic(`component-${control.id}`).fixture, kind: Boolean(control.kind) }, { fixture: false, kind: true }, control.id);
	}
	assert.equal(catalog.find(topic => topic.id === 'component-button').isDraft, true);
	assert.ok(repository.projection.designSpecs.some(spec => spec.kind === 'foundation' && spec.id === 'colors'));

	const deprecated = {
		id: 'old-button', path: 'src/vs/base/browser/ui/button/old-button.design.md',
		title: 'Old Button', kind: 'component', isDraft: false, aliases: ['button-v1'],
		replacedBy: 'button', references: [],
	};
	const migrated = createRepository({
		...repository.projection, designSpecs: [...repository.projection.designSpecs, deprecated],
	});
	assert.deepEqual([
		migrated.getTopic('component-old-button').id,
		migrated.getTopic('component-button-v1').id,
		migrated.catalog.some(topic => topic.id === 'component-old-button'),
	], ['component-button', 'component-button', false]);
});

test('specification aliases resolve to their owning component; families without a specification are not invented', () => {
	for (const spec of repository.projection.designSpecs.filter(spec => spec.kind === 'component')) {
		for (const alias of spec.aliases) {
			assert.equal(getTopic(`component-${alias}`).id, `component-${spec.id}`, alias);
		}
	}
	assert.deepEqual(['icon-button', 'split-button', 'editor-toolbar', 'count-badge'].map(id => getTopic(`component-${id}`).id),
		['component-button', 'component-button', 'component-action-bar', 'component-badge']);
	assert.deepEqual(validateScope({ topics: ['component-icon-button', 'component-button-bar', 'component-icon-label'], active: 'component-icon-button' }).topics,
		['component-button', 'component-button-bar', 'component-icon-label']);
	assert.equal(topicId({ section: 'components', controlId: 'icon-button' }), 'component-button');
	for (const id of ['breadcrumbs', 'tabs', 'quick-pick', 'unrecognized-widget']) {
		assert.throws(() => getTopic(`component-${id}`), /Unknown topic/, id);
	}
	assert.deepEqual(repository.controlGaps, []);
});

test('component bindings name real implementation sources and APIs', () => {
	for (const control of visible) {
		assert.equal(control.content, 'ready', control.id);
		for (const file of [control.owner, ...control.relatedOwners]) {
			assert.ok(existsSync(`${root}/${file}`), `${control.id}: ${file}`);
		}
		const sources = [control.owner, ...control.relatedOwners].map(file => readFileSync(`${root}/${file}`, 'utf8')).join('\n');
		for (const member of control.api) {
			assert.ok(sources.includes(member.split('.')[0]), `${control.id}: ${member}`);
		}
	}
});

test('grouped examples retain primary names, stable fixture IDs, and secondary labels derived from their fixture group', () => {
	const catalog = curateFixtures([
		{ fixtureId: 'button-bar/light', fixtureName: 'Light', groupPath: ['baseUI', 'ButtonBar'] },
		{ fixtureId: 'button/light', fixtureName: 'Light', groupPath: ['baseUI', 'Buttons'] },
		{ fixtureId: 'label/light', fixtureName: 'Light', groupPath: ['baseUI', 'HighlightedLabels'] },
		{ fixtureId: 'icon-label/light', fixtureName: 'Light', groupPath: ['baseUI', 'IconLabels'] },
		{ fixtureId: 'chat/button/light', fixtureName: 'Light', groupPath: ['chat', 'Buttons'] },
	], [
		{ id: 'button', groups: ['baseUI/Buttons'] },
		{ id: 'label', groups: ['baseUI/HighlightedLabels', 'baseUI/IconLabels'] },
		{ id: 'icon-label', groups: ['baseUI/IconLabels'] },
		{ id: 'button-bar', groups: ['baseUI/ButtonBar'] },
	]);
	const variants = id => catalog.find(control => control.id === id).variants.map(({ id, name }) => ({ id, name }));
	assert.deepEqual([variants('button'), variants('label'), variants('icon-label'), variants('button-bar')], [
		[{ id: 'button/light', name: 'Light' }],
		[{ id: 'label/light', name: 'Light' }, { id: 'icon-label/light', name: 'Icon labels · Light' }],
		[{ id: 'icon-label/light', name: 'Light' }],
		[{ id: 'button-bar/light', name: 'Light' }],
	]);
});

test('canonical view state, specification APIs, refresh, and aliases stay coherent', async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'component-icon-button' } });
	try {
		assert.equal(panel.state.scope.active, 'component-button');
		assert.equal(panel.state.scope.topics.some(id => getTopic(id).hidden), false);
		panel.setView({ section: 'components', controlId: 'icon-label', theme: 'Light 2026' });
		assert.equal(panel.view.controlId, 'icon-label');
		assert.equal((await panel.inspectTopic('component-icon-label')).topic, 'component-icon-label');
		const label = (await panel.inspectTopic('component-icon-label', true)).data.controls[0];
		assert.equal(label.docs.api.find(member => member.name.startsWith('IconLabel.setLabel')).source.file,
			'src/vs/base/browser/ui/iconLabel/iconLabel.ts');
		assert.deepEqual(await panel.refreshTopic('component-icon-label'), { topic: 'component-icon-label', refreshed: true });
		panel.setView({ section: 'components', controlId: 'split-button' });
		assert.deepEqual([panel.state.scope.active, panel.view.controlId], ['component-button', 'button']);
		assert.throws(() => panel.setScope({ operation: 'all', active: 'component-breadcrumbs' }), /Unknown topic: component-breadcrumbs/);
		assert.equal(panel.state.scope.active, 'component-button');
	} finally { await panel.close(); }
});
