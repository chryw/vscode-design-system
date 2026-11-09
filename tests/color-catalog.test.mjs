/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { colorDefinitions, createColorResolver } from '../adapters/vscode/color-catalog.mjs';
import { TopicStore } from '../runtime/store.mjs';

const root = workspaceRoot;
const settings = { theme: 'Dark 2026', compareTheme: 'Light 2026', query: '' };

test('consolidated color reader excludes comments and records exact registration sources', () => {
	const definitions = colorDefinitions('// registerColor(\'fake\', null)\nconst id=\'real.constant\';\nconst a=registerColor(id, {dark:null});\nconst b=registerColor(`real.template`, \'#fff\');', 'example.ts');
	assert.deepEqual(definitions.map(item => [item.id, item.definitionSource.line]), [['real.constant', 3], ['real.template', 4]]);
});

test('registry inventory is lazy and retains truthful defaults, ANSI entries, and coverage discrepancies', async () => {
	const store = new TopicStore(root);
	try {
		await store.read('typography', settings);
		assert.ok(!Object.keys(store.metrics.reads).some(file => file.endsWith('/colors/baseColors.ts')));
		const { data } = await store.read('colors', settings);
		assert.ok(data.colorCatalog.length > 900);
		assert.equal(data.colorCatalog.filter(color => /^terminal\.ansi/.test(color.id)).length, 16);
		assert.equal(new Set(data.colorCatalog.map(color => color.id)).size, data.colorCatalog.length);
		const editor = data.colorCatalog.find(color => color.id === 'editor.background');
		assert.match(editor.definitionSource.file, /editorColors\.ts$/);
		assert.match(editor.declarationSource.file, /2026-dark\.json$/);
		assert.match(editor.description, /background/i);
		assert.deepEqual(data.colorPalettes.map(palette => palette.id), ['Light 2026', 'Dark 2026', 'Default High Contrast', 'Default High Contrast Light']);
		assert.equal(editor.values['Dark 2026'].value, editor.value);
		assert.notEqual(editor.values['Light 2026'].value, editor.value);
		assert.equal(editor.values['Default High Contrast'].value.toLowerCase(), '#000000');
		assert.equal(editor.values['Default High Contrast Light'].value.toLowerCase(), '#ffffff');
		const description = data.colorCatalog.find(color => color.id === 'descriptionForeground');
		assert.equal(description.values['Default High Contrast'].value, 'color-mix(in srgb, #FFFFFF 70%, transparent)');
		const contrast = data.colorCatalog.find(color => color.id === 'contrastBorder');
		assert.equal(contrast.values['Dark 2026'].value, 'Unset');
		assert.match(contrast.values['Default High Contrast'].value, /^#/);
		const expected = JSON.parse(readFileSync(`${root}/build/lib/stylelint/vscode-known-variables.json`, 'utf8')).colors;
		const found = new Set(data.colorCatalog.map(color => color.css));
		assert.deepEqual(data.colorRegistryCoverage.unmatchedInventory, expected.filter(css => !found.has(css)));
		for (const color of data.colorCatalog) {
			assert.ok(data.sourceFiles.includes(color.definitionSource.file));
			assert.ok(/^#[\da-f]{3,8}$/i.test(color.value) || color.value.startsWith('color-mix(in srgb,') || ['Unset', 'Runtime-only'].includes(color.value), color.id);
			assert.deepEqual(Object.keys(color.values), data.colorPalettes.map(palette => palette.id));
			for (const value of Object.values(color.values)) {
				assert.ok(/^#[\da-f]{3,8}$/i.test(value.value) || value.value.startsWith('color-mix(in srgb,') || ['Unset', 'Runtime-only'].includes(value.value), color.id);
				if (value.declarationSource) { assert.ok(data.sourceFiles.includes(value.declarationSource.file)); }
			}
		}
		assert.equal(data.colorUsage.length, 11);
		for (const usage of data.colorUsage) {
			assert.ok(data.sourceFiles.includes(usage.source.file));
			assert.ok(readFileSync(`${root}/${usage.source.file}`, 'utf8').split('\n')[usage.source.line - 1].trim());
		}
		const light = await store.read('colors', { ...settings, theme: 'Light 2026' });
		assert.deepEqual(light.data.colorCatalog.map(color => color.id), data.colorCatalog.map(color => color.id));
		assert.notEqual(light.data.colorCatalog.find(color => color.id === 'editor.background').value, editor.value);
	} finally { store.close(); }
});

test('transparent source colors retain their factor and follow referenced theme overrides', () => {
	const definitions = colorDefinitions(`const foreground = registerColor('foreground', '#12345680'); const border = registerColor('border', transparent(foreground, 0.2));`, 'example.ts');
	const byId = new Map(definitions.map(definition => [definition.id, definition]));
	const symbols = new Map(definitions.map(definition => [definition.symbol, definition.id]));
	const resolve = declarations => createColorResolver(byId, symbols, declarations, [], { type: 'vs' })('border').value;
	assert.deepEqual([resolve([]), resolve([{ id: 'foreground', value: '#abcdef' }])], [
		'color-mix(in srgb, #12345680 20%, transparent)',
		'color-mix(in srgb, #abcdef 20%, transparent)',
	]);
});

test('transparent built-in colors resolve widget shadows without inventing a palette', () => {
	const definitions = colorDefinitions(`const shadow = registerColor('widget.shadow', { dark: transparent(Color.black, .36), light: transparent(Color.black, .16), hcDark: null, hcLight: null });`, 'example.ts');
	const byId = new Map(definitions.map(definition => [definition.id, definition]));
	assert.deepEqual(['vs', 'vs-dark', 'hc-black'].map(type => createColorResolver(byId, new Map(), [], [], { type })('widget.shadow').value), [
		'color-mix(in srgb, #000000 16%, transparent)',
		'color-mix(in srgb, #000000 36%, transparent)',
		'Unset',
	]);
});
