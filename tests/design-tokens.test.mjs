/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './repository-helpers.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { definitionEntries, designTokenGroups } from '../view/token-lookup.mjs';
import { readSizeTokens } from '../adapters/vscode/typography.mjs';
import { readMotionDefinitions } from '../adapters/vscode/groups/motion-source.mjs';

const root = workspaceRoot;
const settings = { theme: 'Dark 2026', compareTheme: 'Light 2026', query: '' };

test('explicit size registrations can reference their shared numeric constant', () => {
	const tokens = readSizeTokens('const GAP = 4;\nregisterSize(\'layout.gap\', sizeForAllThemes(GAP, \'px\'), localize(\'gap\', "Gap"));', 'sizes.ts');
	assert.deepEqual(tokens.map(({ id, value }) => ({ id, value })), [{ id: 'layout.gap', value: '4px' }]);
	assert.throws(() => readSizeTokens('registerSize(\'gap\', sizeForAllThemes(missing, \'px\'), localize(\'gap\', "Gap"));', 'sizes.ts'), /Unrecognized size value/);
});

test('the index qualifies documented design decisions rather than styling implementation data', async () => {
	const store = new TopicStore(root);
	try {
		const { data } = await store.read('tokens', settings);
		const entries = definitionEntries(data);
		const get = id => entries.find(entry => entry.id === id);
		const motion = readMotionDefinitions({ root, read: file => readFileSync(`${root}/${file}`, 'utf8'), source: file => ({ file, line: 1 }) });
		const control = motion.tokens.find(token => token.id === 'motion.control.duration');
		assert.deepEqual([
			'spacing.size80', 'fontSize.body1', 'fontWeight.semiBold', 'cornerRadius.medium',
			'codiconFontSize.compact', 'strokeThickness', 'motion.control.duration', 'agents.layout.floatingPanelGap',
		].map(id => [id, get(id).value]), [
			['spacing.size80', '8px'], ['fontSize.body1', '13px'], ['fontWeight.semiBold', '600'], ['cornerRadius.medium', '6px'],
			['codiconFontSize.compact', '12px'], ['strokeThickness', '1px'], ['motion.control.duration', control.value], ['agents.layout.floatingPanelGap', '4px'],
		]);
		assert.equal(get('motion.control.duration').alias, control.alias);
		assert.deepEqual(['motion.duration.normal', 'motion.control.duration', 'motion.progress.duration'].map(id => get(id).category),
			['ramp', 'purpose', 'purpose']);
		assert.equal(get('motion.control.duration').deprecated, undefined);
		assert.equal(get('color.background.accent').purpose, 'Strong emphasis for a leading action. Do not use it to imply success or selection.');
		assert.equal(get('--vscode-shadow-sm').value, '0 0 4px rgba(0, 0, 0, 0.08)');
		assert.equal(get('agents.layout.floatingPanelGap').scope, 'Agents window');
		assert.deepEqual([
			'ZIndex.ModalDialog', 'EDITOR_FONT_DEFAULTS.fontSize', 'Workbench.lineHeight',
			'defaultButtonStyles.buttonForeground', 'EditorTabsControl.EDITOR_TAB_HEIGHT.compact',
			'--vscode-sash-size', '--vscode-shadow-depth-x', 'AGENTS_CENTERED_CONTENT_MAX_WIDTH',
			'Codicon.add', 'languageIds.typescript', 'Dark Accent / Blue 01', 'Typography / Heading 4',
			'motion.control', 'editor.background',
		].filter(id => get(id)), []);
		assert.equal(entries.every(entry => entry.css.startsWith('--')), true);
		assert.deepEqual([...designTokenGroups(entries).keys()], [
			'spacing', 'typography', 'shape', 'iconography', 'stroke', 'colors', 'elevation', 'motion', 'layout', 'legacy',
		]);
		assert.deepEqual(designTokenGroups(entries).get('spacing').map(token => token.value), [
			'0px', '2px', '4px', '6px', '8px', '10px', '12px', '16px', '20px', '24px', '28px', '32px', '36px', '40px',
		]);
		for (const token of entries.filter(token => token.deprecated)) {
			assert.ok(token.alias && get(token.alias), token.id);
			assert.equal(token.value, get(token.alias).value);
		}
		const lines = new Map();
		for (const item of [...entries, ...data.tokenGuidance]) {
			assert.ok(data.sourceFiles.includes(item.source.file), item.id);
			if (!lines.has(item.source.file)) { lines.set(item.source.file, readFileSync(`${root}/${item.source.file}`, 'utf8').split('\n')); }
			assert.ok(lines.get(item.source.file)[item.source.line - 1].trim(), item.id);
		}
		assert.equal(data.colorCatalog, undefined);
		assert.deepEqual(data.icons, []);
		assert.equal(data.sourceFiles.some(file => /defaultStyles|zIndexRegistry|codiconsLibrary|theme-seti\/icons\/|editorTabsControl/.test(file)), false);
		assert.deepEqual(definitionEntries({ ...data, icons: [{ id: 'fake' }], consistency: [{ id: 'fake' }], colorCatalog: [{ id: 'fake' }] }), entries);
	} finally { store.close(); }
});

test('qualified color roles preserve theme-dependent, unset, and referenced defaults', async () => {
	const store = new TopicStore(root);
	try {
		const colors = async theme => definitionEntries((await store.read('tokens', { ...settings, theme })).data).filter(token => token.group === 'colors');
		const dark = await colors('Dark 2026');
		const light = await colors('Light 2026');
		const contrast = await colors('Default High Contrast');
		assert.equal(dark.find(token => token.id === 'color.border.contrast').value, 'Unset');
		assert.equal(dark.find(token => token.id === 'color.text').value.toUpperCase(), '#CCCCCC');
		assert.equal(light.find(token => token.id === 'color.text').value.toUpperCase(), '#616161');
		assert.equal(contrast.find(token => token.id === 'color.border.error').defaultAlias, 'color.border.contrast');
		assert.equal(contrast.find(token => token.id === 'color.border.error').value, contrast.find(token => token.id === 'color.border.contrast').value);
	} finally { store.close(); }
});
