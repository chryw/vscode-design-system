/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { controls, curateFixtures, catalog, getTopic, repository, topicId, validateScope } from './repository-helpers.mjs';
import { createExplorer } from '../runtime/server.mjs';
import { createRepository } from '../model/repository.mjs';

const root = workspaceRoot;
const visible = controls.filter(control => !control.hidden);

test('component topics are reusable contracts, not individual toolkit fragments or product shells', () => {
	assert.deepEqual(visible.map(control => control.id).sort(), [
		'action-bar', 'badge', 'breadcrumbs', 'button', 'checkbox', 'combobox', 'dialog', 'dropdown', 'form-label',
		'hover', 'input', 'keybinding-label', 'label', 'link', 'list', 'menu', 'message', 'pane', 'pill', 'progress',
		'quick-pick', 'radio', 'sash', 'scroll-area', 'select', 'separator', 'spinner', 'switch', 'table', 'tabs', 'toggle', 'tooltip', 'tree',
	]);
	assert.equal(new Set(controls.map(control => control.id)).size, controls.length);
	assert.deepEqual(visible.map(control => control.name), visible.map(control => control.name).sort((a, b) => a.localeCompare(b, 'en')));
	for (const id of ['chat-message-header', 'chat-input-action', 'notebook-code-cell', 'window-control', 'extension-row', 'editor-minimap']) {
		assert.equal(getTopic(`component-${id}`).hidden, true, id);
		assert.equal(controls.find(control => control.id === id).archived, true, id);
	}
	assert.equal(catalog.some(topic => topic.id === 'components'), false);
	assert.equal(visible.every(control => !('family' in control)), true);
	const visibleComponents = catalog.filter(topic => !topic.hidden && topic.group === 'Components');
	assert.ok(visibleComponents.some(topic => topic.subgroup === 'Primitives'));
	assert.ok(visibleComponents.some(topic => topic.subgroup === 'Composites'));
	assert.ok(visibleComponents.every(topic => topic.subgroup === undefined || ['Primitives', 'Composites'].includes(topic.subgroup)));
	const listed = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/book.mjs', import.meta.url)), 'list', '--root', root], { cwd: root, encoding: 'utf8' }));
	assert.deepEqual(listed.topics.map(topic => topic.id), catalog.filter(topic => !topic.hidden).map(topic => topic.id));
});

test('specification metadata drives readiness and component grouping independently of fixtures', () => {
	const draftTopics = catalog.filter(topic => topic.status === 'draft');
	const primitives = catalog.filter(topic => topic.subgroup === 'Primitives');
	const composites = catalog.filter(topic => topic.subgroup === 'Composites');
	const fixtureWithoutSpec = controls.find(control => control.id === 'badge');
	assert.ok(draftTopics.length > 0);
	assert.ok(draftTopics.some(topic => !topic.hidden));
	assert.ok(draftTopics.some(topic => topic.hidden));
	assert.ok(primitives.length > 0);
	assert.ok(composites.length > 0);
	assert.equal(fixtureWithoutSpec.groups.length > 0, true);
	assert.equal(fixtureWithoutSpec.kind, undefined);
	assert.equal(catalog.find(topic => topic.id === 'component-button').status, 'draft');
	assert.ok(repository.projection.designSpecs.some(spec => spec.kind === 'foundation' && spec.id === 'colors'));

	const deprecated = {
		id: 'old-button', path: 'src/vs/base/browser/ui/button/old-button.design.md',
		title: 'Old Button', kind: 'primitive', status: 'deprecated', aliases: ['button-v1'], legacyPaths: [],
		replacedBy: 'button', references: [],
	};
	const migrated = createRepository({
		...repository.projection, designSpecs: [...repository.projection.designSpecs, deprecated],
	});
	assert.deepEqual([
		migrated.getTopic('component-old-button').id,
		migrated.getTopic('component-button-v1').id,
	], ['component-button', 'component-button']);
});

test('related variants and structural parts resolve to their component family', () => {
	assert.deepEqual([
		'icon-button', 'split-button', 'button-bar', 'dropdown-button', 'icon-label', 'textarea',
		'editor-toolbar', 'menu-item', 'menu-section-title', 'file-row', 'folder-row',
		'quick-pick-shortcut', 'chat-attachment', 'notification-header', 'sidebar-header', 'status-icon',
	].map(id => getTopic(`component-${id}`).id), [
		'component-button', 'component-button', 'component-button-bar', 'component-button', 'component-icon-label', 'component-input',
		'component-action-bar', 'component-menu', 'component-menu', 'component-list', 'component-tree',
		'component-quick-pick', 'component-pill', 'component-message', 'component-pane', 'iconography',
	]);
	assert.deepEqual(validateScope({ topics: ['component-icon-button', 'component-button-bar', 'component-icon-label'], active: 'component-icon-button' }).topics,
		['component-button', 'component-button-bar', 'component-icon-label']);
	assert.equal(topicId({ section: 'components', controlId: 'status-icon' }), 'iconography');
	assert.throws(() => getTopic('component-unrecognized-widget'), /Unknown topic/);
});

test('qualification uses extracted product abstractions and preserves missing-reference boundaries', () => {
	for (const [id, file, symbol] of [
		['button', 'src/vs/base/browser/ui/button/button.ts', 'export class ButtonWithDropdown'],
		['action-bar', 'src/vs/base/browser/ui/toolbar/toolbar.ts', 'export class ToolBar'],
		['pane', 'src/vs/base/browser/ui/splitview/paneview.ts', 'export class PaneView'],
		['quick-pick', 'src/vs/platform/quickinput/browser/quickInput.ts', 'export class QuickPick'],
		['pill', 'src/vs/workbench/browser/chatPills.ts', 'export class ChatPillsWidget'],
	]) {
		const control = visible.find(control => control.id === id);
		assert.ok([control.owner, control.evidence, ...(control.relatedOwners ?? [])].includes(file));
		assert.ok(readFileSync(`${root}/${file}`, 'utf8').includes(symbol));
	}
	for (const id of ['form-label', 'combobox', 'tabs', 'pill', 'menu']) {
		const control = visible.find(control => control.id === id);
		assert.equal(control.content, 'tbd');
		assert.deepEqual(control.groups, []);
	}
	assert.ok(visible.find(control => control.id === 'button').members.includes('ButtonBar'));
	assert.ok(visible.find(control => control.id === 'label').members.includes('IconLabel'));
	assert.ok(visible.find(control => control.id === 'menu').members.includes('Section label'));
});

test('grouped examples retain primary names, stable fixture IDs, and distinct secondary labels', () => {
	const catalog = curateFixtures([
		{ fixtureId: 'button-bar/light', fixtureName: 'Light', groupPath: ['baseUI', 'ButtonBar'] },
		{ fixtureId: 'button/light', fixtureName: 'Light', groupPath: ['baseUI', 'Buttons'] },
		{ fixtureId: 'label/light', fixtureName: 'Light', groupPath: ['baseUI', 'HighlightedLabels'] },
		{ fixtureId: 'icon-label/light', fixtureName: 'Light', groupPath: ['baseUI', 'IconLabels'] },
		{ fixtureId: 'chat/button/light', fixtureName: 'Light', groupPath: ['chat', 'Buttons'] },
	]);
	const variants = id => catalog.find(control => control.id === id).variants.map(({ id, name }) => ({ id, name }));
	assert.deepEqual(variants('button'), [{ id: 'button/light', name: 'Light' }, { id: 'button-bar/light', name: 'Button group · Light' }]);
	assert.deepEqual(variants('label'), [{ id: 'label/light', name: 'Light' }, { id: 'icon-label/light', name: 'Icon label · Light' }]);
	assert.deepEqual(variants('icon-label'), [{ id: 'icon-label/light', name: 'Light' }]);
});

test('canonical view state, source APIs, refresh, and explicit archives stay coherent', async () => {
	const panel = await createExplorer(root, { scope: { operation: 'all', active: 'component-chat-attachment' } });
	try {
		assert.equal(panel.state.scope.active, 'component-pill');
		assert.equal(panel.state.scope.topics.some(id => getTopic(id).hidden), false);
		panel.setView({ section: 'components', controlId: 'icon-label', theme: 'Light 2026' });
		assert.equal(panel.view.controlId, 'icon-label');
		assert.equal((await panel.inspectTopic('component-icon-label')).topic, 'component-icon-label');
		const label = (await panel.inspectTopic('component-icon-label', true)).data.controls[0];
		assert.equal(label.docs.api.find(member => member.name === 'IconLabel.setLabel(label, description, options)').source.file,
			'src/vs/base/browser/ui/iconLabel/iconLabel.ts');
		assert.deepEqual(await panel.refreshTopic('component-icon-label'), { topic: 'component-icon-label', refreshed: true });
		panel.setView({ section: 'components', controlId: 'status-icon' });
		assert.equal(panel.state.scope.active, 'iconography');
		assert.equal(panel.view.section, 'iconography');
		assert.equal(panel.view.controlId, '');
		panel.setScope({ operation: 'all', active: 'component-notebook' });
		assert.equal(panel.state.scope.active, 'component-notebook');
		assert.equal(panel.state.scope.topics.filter(id => getTopic(id).hidden).length, 1);
		assert.equal((await panel.inspectTopic('component-notebook', true)).data.controls[0].content, 'tbd');
		panel.setScope({ operation: 'all', active: 'component-button' });
		assert.equal(panel.state.scope.topics.some(id => getTopic(id).hidden), false);
	} finally { await panel.close(); }
});
