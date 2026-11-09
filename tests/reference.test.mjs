/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { catalog, sections, controls, curateFixtures, foundationSections, pageStructures } from './repository-helpers.mjs';
import { parseJsonc } from '../adapters/vscode/jsonc.mjs';
import { TopicStore } from '../runtime/store.mjs';
import { toolkitSpecifications, specificationUrl } from '../view/component-specs.mjs';
import { pageJumps, topicPresentation } from '../view/navigation-model.mjs';
import { findTokens, lookupEntries, visualTokens, corePaletteThemes, designTokenGroups, definitionEntries } from '../view/token-lookup.mjs';
import { readPage } from '../adapters/vscode/groups/authored.mjs';
import { ansiRegistryFile, readAnsiColors } from '../adapters/vscode/ansi-colors.mjs';
import { parseProvenance, readProvenance } from '../adapters/vscode/provenance.mjs';
import { selectFixtureSession } from '../adapters/vscode/fixtures.mjs';
import { createReferenceModel } from '../adapters/vscode/reference-model.mjs';
import { iconRowEnd } from '../view/icons.mjs';
import path from 'node:path';

const root = workspaceRoot;
const settings = { theme: 'Dark 2026', compareTheme: 'Light 2026' };
const sourceLine = source => readFileSync(path.join(root, source.file), 'utf8').split('\n')[source.line - 1];
function reader(t) {
	const store = new TopicStore(root);
	t.after(() => store.close());
	return async (id, patch = {}) => (await store.read(id, { ...settings, ...patch })).data;
}

test('JSONC preserves comment markers, escaped quotes, and trailing comma strings', () => {
	assert.deepEqual(parseJsonc('{\n// comment\n"url":"https://example.test/a/*b*/", "quote":"a\\"b,}", /* multi\nline */ "items":[1,],}'), {
		url: 'https://example.test/a/*b*/', quote: 'a"b,}', items: [1],
	});
	assert.throws(() => parseJsonc('{/* unfinished'), /Unterminated/);
	assert.throws(() => parseJsonc('{"bad": undefined}'), SyntaxError);
});

test('source identity distinguishes local branch/worktree, main checkout, and detached state without claiming deployment', () => {
	const paths = ['/repo/.git/worktrees/topic', '/repo/.git', '/repo/topic'];
	const topic = parseProvenance('# branch.oid abcdef1234\n# branch.head topic\n? local-file', paths);
	assert.deepEqual({ kind: topic.kind, branch: topic.branch, commit: topic.commit, worktree: topic.worktree, modified: topic.modified },
		{ kind: 'Local worktree', branch: 'topic', commit: 'abcdef1234', worktree: 'topic', modified: true });
	const main = parseProvenance('# branch.oid abcdef1234\n# branch.head main', ['/repo/.git', '/repo/.git', '/repo']);
	assert.equal(main.kind, 'Local main checkout');
	assert.equal(main.modified, false);
	assert.match(main.deployment, /not a verified deployment/);
	assert.equal(parseProvenance('# branch.oid abcdef1234\n# branch.head (detached)', paths).branch, 'Detached HEAD');
	assert.throws(() => parseProvenance('', paths), /branch and commit metadata/);
	assert.equal(readProvenance(root).worktreePath, root);
});

test('token and icon topics retain exact registrations, inherited overrides, and source positions', async t => {
	const read = reader(t);
	const { sizes } = await read('tokens');
	const { colors } = await read('theming');
	const { icons } = await read('iconography');
	assert.ok(sizes.length >= 36 && icons.length > 700);
	assert.deepEqual(sizes.find(token => token.id === 'cornerRadius.small'), {
		id: 'cornerRadius.small', value: '4px', css: '--vscode-cornerRadius-small',
		description: 'Small corner radius for compact UI elements.', category: 'shape',
		deprecated: false, source: { file: 'src/vs/platform/theme/common/sizes/baseSizes.ts', line: 98 },
	});
	assert.equal(colors.find(token => token.id === 'button.background').value, '#297AA0');
	for (const token of [...sizes, ...colors, ...icons]) {
		assert.ok(sourceLine(token.source).includes(token.id), `${token.id} source line`);
	}
});

test('typography covers active styles, aliases, font stacks, and real source boundaries', async t => {
	const system = await reader(t)('typography');
	const { tokens, families, baseline } = system.typography;
	assert.deepEqual({
		count: tokens.length, roles: tokens.filter(token => token.id.startsWith('fontSize.')).length,
		weights: tokens.filter(token => token.id.startsWith('fontWeight.')).length,
		icons: tokens.filter(token => token.id.startsWith('codiconFontSize')).length,
		aliases: tokens.filter(token => token.deprecated).length, families: families.length,
		defaultFamilies: families.filter(family => family.locale === 'Default').length,
		baseline: { fontSize: baseline.fontSize, lineHeight: baseline.lineHeight },
	}, { count: 25, roles: 8, weights: 2, icons: 2, aliases: 13, families: 18, defaultFamilies: 6, baseline: { fontSize: '13px', lineHeight: '1.4em' } });
	for (const token of tokens) {
		assert.ok(sourceLine(token.source).includes(token.id));
		if (token.deprecated) {
			assert.equal(tokens.find(item => item.id === token.replacement).value, token.value);
		}
	}
	assert.equal(tokens.some(token => /lineHeight|letterSpacing|fontFamily/.test(token.id)), false);
});

test('all contributed themes load without inventing runtime defaults', async t => {
	const read = reader(t);
	const system = await read('theming');
	assert.ok(system.themes.length >= 19);
	assert.deepEqual(system.themeGallery.map(theme => theme.id), system.themes.map(theme => theme.id));
	for (const theme of system.themes) {
		const snapshot = await read('theming', { theme: theme.id });
		assert.equal(snapshot.theme.id, theme.id);
		assert.equal(snapshot.chain.at(-1), theme.file);
	}
	const contrast = await read('theming', { theme: 'Default High Contrast Light' });
	assert.equal(contrast.colors.some(token => token.id === 'button.background'), false);
	await assert.rejects(read('theming', { theme: '../../outside' }), /Unknown theme/);
	assert.notEqual(system.comparison.colors.find(token => token.id === 'editor.background').value, system.colors.find(token => token.id === 'editor.background').value);
});

test('all 16 customizable terminal ANSI colors resolve from source defaults or theme overrides', () => {
	const registry = readFileSync(path.join(root, ansiRegistryFile), 'utf8');
	for (const [type, blue, black] of [['vs-dark', '#2472c8', '#000000'], ['vs', '#0451a5', '#000000'], ['hc-black', '#0000ee', '#000000'], ['hc-light', '#0451a5', '#292929']]) {
		const colors = readAnsiColors(registry, { type }, []);
		assert.deepEqual(colors.map(color => color.ansiIndex), Array.from({ length: 16 }, (_, index) => index));
		assert.equal(colors.find(color => color.id === 'terminal.ansiBlue').value, blue);
		assert.equal(colors.find(color => color.id === 'terminal.ansiBlack').value, black);
	}
	const source = { file: 'theme.json', line: 42 };
	const overridden = readAnsiColors(registry, { type: 'vs-dark' }, [{ id: 'terminal.ansiRed', value: '#123456', source }]);
	assert.deepEqual(overridden.filter(color => color.id === 'terminal.ansiRed').map(({ value, origin, source }) => ({ value, origin, source })),
		[{ value: '#123456', origin: 'theme', source }]);
	assert.throws(() => readAnsiColors('', { type: 'vs-dark' }, []), /registry changed/);
});

test('theme illustrations use overrides and source-registered defaults across all theme types', async t => {
	const { themeGallery } = await reader(t)('theming');
	const find = id => themeGallery.find(theme => theme.id === id).palette;
	assert.deepEqual([find('Dark 2026').editor, find('Default High Contrast').editor, find('Default High Contrast Light').editor, find('Visual Studio Dark').activity],
		['#121314', '#000000', '#FFFFFF', '#333333']);
	assert.notEqual(find('Light 2026').agents, find('Dark 2026').agents);
	for (const theme of themeGallery) {
		for (const [role, color] of Object.entries(theme.palette)) {
			if (role !== 'agentsBorderOpacity') { assert.match(color, /^(?:#[\da-f]{3,8}|none)$/i, `${theme.id}: ${role}`); }
		}
	}
});

test('component references validate real APIs while reserved topics expose no invented content', async t => {
	const read = reader(t);
	for (const entry of controls.filter(control => !control.hidden)) {
		const { controls: [control] } = await read(`component-${entry.id}`);
		if (entry.content === 'tbd') {
			assert.deepEqual(control.docs, { summary: entry.reason });
			assert.deepEqual(control.groups, []);
			continue;
		}
		assert.ok(control.docs.summary && control.docs.className && control.docs.preview);
		assert.ok(control.docs.usage.length && control.docs.accessibility.length && control.docs.api.length >= 4);
		for (const prop of control.docs.api) {
			assert.ok([control.owner, ...(control.relatedOwners ?? [])].includes(prop.source.file));
			assert.ok(sourceLine(prop.source).trim());
		}
	}
	assert.equal((await read('components')).controls[0].id, 'button');
});

test('toolkit evidence is retained without promoting every specification to primary navigation', () => {
	assert.equal(toolkitSpecifications.length, 118);
	assert.equal(new Set(toolkitSpecifications.map(specification => specification.id)).size, toolkitSpecifications.length);
	assert.deepEqual(controls.map(control => control.name), controls.map(control => control.name).sort((a, b) => a.localeCompare(b, 'en')));
	for (const specification of toolkitSpecifications) {
		const control = controls.find(control => control.id === specification.id);
		assert.equal(control.nodeId, specification.nodeId);
		assert.match(specificationUrl(control.nodeId), /^https:\/\/www\.figma\.com\/design\/AJnTgc00iEI0KTVdyoN997\/\?node-id=\d+-\d+$/);
	}
	assert.equal(controls.filter(control => control.content === 'ready').length, 15);
	assert.equal(catalog.some(topic => topic.id === 'components'), false);
	for (const control of controls) {
		const topic = catalog.find(topic => topic.controlId === control.id);
		assert.equal('family' in control || 'subgroup' in topic, false);
		assert.deepEqual({ content: topic.content, fixture: topic.fixture, hidden: topic.hidden },
			{ content: control.content, fixture: control.content === 'ready', hidden: control.hidden });
	}
});

test('navigation and page structures are metadata, not a second source inventory', () => {
	assert.deepEqual(sections.filter(section => !['motion', 'patterns'].includes(section.id))
		.filter(section => !readPage(file => readFileSync(`${root}/${file}`, 'utf8'), section.id).authored.intro).map(section => section.id), []);
	assert.deepEqual(pageJumps({ section: 'components' }, readPage(file => readFileSync(`${root}/${file}`, 'utf8'), 'components').page).map(item => item.anchor),
		['component-example', 'component-usage', 'component-accessibility', 'component-api']);
	for (const id of [...foundationSections, 'accessibility', 'content', 'components']) {
		assert.ok(pageStructures[id].length >= 2 && new Set(pageStructures[id]).size === pageStructures[id].length, id);
	}
});

test('foundation source actions and presentation policy use only the selected topic', async t => {
	const read = reader(t);
	for (const section of foundationSections) {
		const system = await read(section);
		const policy = topicPresentation(system, { section });
		assert.ok(system.sourceFiles.includes(policy.source.file), `${section} source action is allowlisted`);
		assert.deepEqual({ foundation: policy.foundation, search: policy.search, theme: policy.theme },
			{ foundation: true, search: section === 'tokens', theme: false });
	}
	assert.deepEqual(corePaletteThemes.map(theme => theme.id), ['Light 2026', 'Dark 2026', 'Default High Contrast', 'Default High Contrast Light']);
});

test('lookup uses central registrations, real identity and values, with canonical tokens before aliases', async t => {
	const system = await reader(t)('tokens');
	const entries = definitionEntries(system);
	assert.ok(entries.some(entry => entry.source.file === 'src/vs/platform/theme/common/motionRegistry.ts'));
	assert.ok(entries.some(entry => entry.source.file === 'src/vs/platform/theme/common/colors/semanticColors.ts'));
	for (const query of ['fontSize.body1', '--vscode-fontSize-body1', 'var(--vscode-fontSize-body1)']) {
		assert.equal(findTokens(system.sizes, query)[0].id, 'fontSize.body1');
	}
	assert.deepEqual(findTokens(system.sizes, 'not-a-token'), []);
	assert.equal(findTokens(system.sizes, '').length, system.sizes.length);
	const firstAlias = entries.findIndex(entry => entry.deprecated);
	assert.ok(firstAlias > 0 && entries.slice(firstAlias).every(entry => entry.deprecated && entry.alias));
	assert.equal(definitionEntries(system, 'button.background').length, 0);
	for (const entry of lookupEntries({ ...system, colors: [] })) {
		const token = system.sizes.find(token => token.id === entry.id);
		assert.deepEqual(entry, { id: token.id, css: token.css, value: token.value, category: token.category, source: token.source, alias: token.deprecated ? token.replacement : undefined });
	}
	assert.ok(designTokenGroups(entries).has('colors'));
	assert.ok(designTokenGroups(entries).has('layout'));
});

test('visual scales and scoped coverage reflect source changes rather than hardcoded gaps', async t => {
	const read = reader(t);
	for (const section of ['spacing', 'shape']) {
		const system = await read(section);
		assert.deepEqual(new Set(visualTokens(system, section).map(token => token.id)), new Set(system.sizes.filter(token => !token.deprecated).map(token => token.id)));
		assert.ok(system.reference.topics[section].every(item => item.scope.length && item.scope.every(file => system.sourceFiles.includes(file))));
	}
	const spacing = await read('spacing');
	assert.equal(spacing.reference.topics.spacing.find(item => item.expected === 'Named semantic spacing roles').status, 'not-defined-in-covered-sources');
	const future = { ...spacing, sizes: [...spacing.sizes, { ...spacing.sizes[0], id: 'spacing.group', deprecated: false }] };
	assert.equal(createReferenceModel(future, ['spacing']).topics.spacing.find(item => item.expected === 'Named semantic spacing roles').status, 'source-defined');
	const typography = await read('typography');
	assert.deepEqual(typography.reference.scales.typeRoles.map(token => token.id),
		typography.typography.tokens.filter(token => token.id.startsWith('fontSize.') && !token.deprecated).map(token => token.id));
	assert.equal(typography.reference.topics.typography[1].status, 'implementation-only');
	const metrics = { ...typography, sizes: [...typography.sizes, { ...typography.sizes[0], id: 'lineHeight.body1', deprecated: false }] };
	assert.equal(createReferenceModel(metrics, ['typography']).topics.typography[2].status, 'source-defined');
	assert.throws(() => createReferenceModel({ ...spacing, documents: {} }, ['shape']), /needs the covered source/);
});

test('elevation reads live tier guidance, registered radii, and actual shadow sources', async t => {
	const system = await reader(t)('elevation');
	assert.match(system.elevation.tiers.text, /Control.*cornerRadius-small/);
	assert.match(system.elevation.tiers.text, /Inner.*cornerRadius-medium/);
	assert.match(system.elevation.tiers.text, /Outer.*cornerRadius-large/);
	assert.deepEqual(system.elevation.shadows.registrations.map(({ id, defaults }) => ({ id, defaults })), [
		{ id: 'widget.shadow', defaults: '{ dark: transparent(Color.black, .36), light: transparent(Color.black, .16), hcDark: null, hcLight: null }' },
		{ id: 'widget.border', defaults: '{ dark: null, light: null, hcDark: contrastBorder, hcLight: contrastBorder }' },
	]);
	assert.deepEqual(system.reference.scales.shadows.map(token => token.css), ['--vscode-shadow-sm', '--vscode-shadow-md', '--vscode-shadow-lg', '--vscode-shadow-xl']);
	for (const token of system.reference.scales.shadows) { assert.ok(sourceLine(token.source).includes(token.value)); }
	assert.equal(system.reference.topics.elevation[0].status, 'source-defined');
	assert.equal(createReferenceModel({ ...system, elevation: { ...system.elevation, shadowUsage: [] } }, ['elevation']).topics.elevation[2].status, 'not-assessed');
});

test('motion distinguishes explanatory topics, implementation observations, and product tokens', async t => {
	const system = await reader(t)('motion');
	for (const sample of system.motion) {
		for (const declaration of sample.declarations) {
			const line = sourceLine(declaration.source);
			assert.ok(line.includes(declaration.property) && line.includes(declaration.value));
		}
	}
	assert.equal(system.sizes.some(token => token.id.startsWith('motion.')), false);
	assert.deepEqual(system.page.sections, system.motionDocumentation.page.sections.map(({ id, heading, title }) => ({
		id: `motion-${id}`, title: title ?? system.motionDocumentation.sections[heading].title,
	})));
});

test('icon expansion follows the selected visual row, including narrow and partial rows', () => {
	assert.deepEqual([[0, 4, 10], [3, 4, 10], [4, 4, 10], [8, 4, 10], [4, 1, 10]].map(args => iconRowEnd(...args)), [3, 3, 7, 9, 4]);
});

test('fixture curation includes exact reusable-control groups, not feature composites', () => {
	const result = curateFixtures([
		{ fixtureId: 'baseUI/Buttons/Dark', fixtureName: 'Dark', groupPath: ['baseUI', 'Buttons'] },
		{ fixtureId: 'chat/Buttons/Dark', fixtureName: 'Dark', groupPath: ['chat', 'Buttons'] },
		{ fixtureId: 'baseUI/ButtonsComposite/Dark', fixtureName: 'Dark', groupPath: ['baseUI', 'ButtonsComposite'] },
		{ fixtureId: 'editor/multiSelectDropdown/Weekdays/Light', fixtureName: 'Light', groupPath: ['editor', 'multiSelectDropdown', 'Weekdays'] },
	]);
	assert.deepEqual(result.filter(control => control.variants.length).map(control => ({ id: control.id, variants: control.variants.map(variant => variant.id) })), [
		{ id: 'button', variants: ['baseUI/Buttons/Dark'] },
	]);
	assert.equal(result.length, controls.length);
	assert.throws(() => curateFixtures({}), /invalid fixture catalog/);
});

test('fixture discovery accepts only an existing local session, never a cloud or ambiguous endpoint', () => {
	const sessions = [{ name: 'baseline', serverUrl: 'http://localhost:5124' }, { name: 'current', serverUrl: 'http://localhost:5126' }];
	assert.deepEqual(selectFixtureSession(sessions, ''), { session: sessions[1], explorerUrl: 'http://localhost:5126/___explorer' });
	assert.equal(selectFixtureSession(sessions, 'http://localhost:5124/___explorer').session.name, 'baseline');
	assert.throws(() => selectFixtureSession([], ''), /No unambiguous/);
	assert.throws(() => selectFixtureSession([{ name: 'one', serverUrl: 'http://localhost:1' }, { name: 'two', serverUrl: 'http://localhost:2' }], ''), /No unambiguous/);
	assert.throws(() => selectFixtureSession([{ name: 'current', serverUrl: 'https://example.test' }], ''), /loopback/);
	assert.throws(() => selectFixtureSession(sessions, 'http://localhost:9999/___explorer'), /does not match/);
	assert.equal(catalog.filter(entry => entry.id.startsWith('component-')).length, controls.length);
});
