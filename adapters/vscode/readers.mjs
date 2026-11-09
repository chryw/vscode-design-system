/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createReferenceModel } from './reference-model.mjs';
import { readProvenance } from './provenance.mjs';
import { contained } from '../../runtime/paths.mjs';
import { documentView } from '../../model/documents.mjs';

export function canonicalRoot(root) {
	const result = realpathSync(root);
	if (!existsSync(path.join(result, 'src/vs/platform/theme/common/sizes/baseSizes.ts'))) {
		throw new Error('Select a VS Code checkout');
	}
	return result;
}

export const vscodeAdapter = {
	canonicalRoot,
	sourcePath(root, file, bookRoot) {
		const prefix = '.github/design-system/';
		return typeof file === 'string' && file.startsWith(prefix) ? contained(bookRoot, file.slice(prefix.length)) : contained(root, file);
	},
	readTopic: (...args) => readTopic(...args),
	readProvenance,
	loadFixtureCatalog: async (...args) => (await import('./fixtures.mjs')).loadFixtureCatalog(...args),
};

const loaders = {
	sizes: () => import('./groups/sizes.mjs'), typography: () => import('./groups/typography.mjs'),
	themes: () => import('./groups/themes.mjs'), icons: () => import('./groups/icons.mjs'),
	guidance: () => import('./groups/guidance.mjs'), philosophy: () => import('./groups/philosophy.mjs'),
	elevation: () => import('./groups/elevation.mjs'), motion: () => import('./groups/motion.mjs'),
	components: () => import('./groups/components.mjs'), spacing: () => import('./groups/spacing.mjs'),
	colorUsage: () => import('./groups/color-usage.mjs'),
	designTokens: () => import('./groups/design-tokens.mjs'),
	motionAppearance: () => import('./groups/motion-appearance.mjs'),
	documents: () => import('./groups/documents.mjs'),
	sourceDocuments: () => import('./groups/source-documents.mjs'),
};
export async function readTopic(store, id, settings) {
	const { sections, getTopic, projection } = store.repository;
	const entry = getTopic(id);
	const section = entry.section;
	const group = (name, args = []) => store.group(name, args, async context => (await loaders[name]()).load(context, ...args));
	const dependencies = [];
	const use = async (name, args) => {
		store.declare(id, store.key(name, args));
		const result = await group(name, args);
		dependencies.push(result);
		return result.value;
	};
	// Empty fields are structural adapters for retained templates, not invented source defaults.
	const data = {
		sections, sizes: [], colors: [], themes: [], themeGallery: [], icons: [], motion: [],
		catalog: store.repository.catalog, repositoryReferences: projection.references, referenceExpectations: projection.expectations,
		typography: { tokens: [], families: [] }, elevation: { cssShadows: [], shadowUsage: [] },
		documents: {}, controls: [], theme: { id: settings.theme }, chain: [],
		view: { section, controlId: entry.controlId ?? '', ...settings }, controlGaps: [],
		codiconFontAvailable: existsSync(path.join(store.root, 'node_modules/@vscode/codicons/dist/codicon.ttf')),
	};
	Object.assign(data, await use('guidance', [section]));
	if (['typography', 'spacing', 'shape', 'size', 'stroke', 'tokens', 'layout'].includes(section)) {
		Object.assign(data, await use('sizes'));
	}
	if (section === 'typography' || section === 'tokens') {
		Object.assign(data, await use('typography', [data.sizes]));
		if (section === 'tokens') {
			data.sizes = [...data.sizes, ...data.typography.tokens.filter(item => !data.sizes.some(token => token.id === item.id))];
		}
	}
	if (['colors', 'theming', 'tokens'].includes(section)) {
		Object.assign(data, await use('themes', [settings.theme, settings.compareTheme, section === 'colors']));
	}
	if (section === 'tokens') { Object.assign(data, await use('designTokens', [data.theme, data.colors])); }
	if (section === 'colors') { Object.assign(data, await use('colorUsage')); }
	if (section === 'iconography' || section === 'size') {
		Object.assign(data, await use('icons', [section === 'size']));
	}
	if (section === 'principles') { Object.assign(data, await use('philosophy')); }
	if (section === 'spacing') { Object.assign(data, await use('spacing')); }
	if (section === 'shape' || section === 'elevation' || section === 'tokens') { Object.assign(data, await use('elevation')); }
	if (section === 'motion') {
		Object.assign(data, await use('motion'));
		if (data.motionDocumentation.status === 'defined') {
			Object.assign(data, await use('sizes'));
			Object.assign(data, await use('typography', [data.sizes]));
			const palettes = await use('themes', ['Dark 2026', 'Light Modern', false, false]);
			Object.assign(data, await use('icons', [['play', 'debug-pause', 'debug-restart', 'loading']]));
			Object.assign(data, await use('motionAppearance', [palettes.theme, palettes.colors, palettes.comparison.theme, palettes.comparison.colors]));
		}
	}
	if (section === 'components') { Object.assign(data, await use('components', [entry.controlId])); }
	if (section === 'documentation') { data.library = documentView(await use('documents'), settings); }
	const sourceDocuments = [...new Set(dependencies.flatMap(item => item.files))].filter(file => file.endsWith('.md'));
	if (section !== 'documentation') { Object.assign(data, await use('sourceDocuments', [sourceDocuments])); }
	data.sourceFiles = [...new Set(dependencies.flatMap(item => item.files))];
	if (data.library?.document) { data.sourceFiles.push(data.library.document.source.file); }
	data.reference = createReferenceModel(data, ['components', 'tokens', 'accessibility', 'content', 'patterns', 'documentation'].includes(section) ? [] : [section]);
	data.reference.expected = { [section]: data.reference.expected[section] };
	data.reference.structure = { [section]: data.reference.structure[section] };
	if (['spacing', 'layout'].includes(section)) { data.sizes = data.sizes.filter(token => token.category === 'spacing'); }
	if (section === 'shape') { data.sizes = data.sizes.filter(token => token.id.startsWith('cornerRadius.')); }
	if (section === 'size') { data.sizes = data.sizes.filter(token => token.id.startsWith('codiconFontSize')); }
	if (section === 'stroke') { data.sizes = data.sizes.filter(token => token.id === 'strokeThickness'); }
	if (section === 'typography') { data.sizes = data.sizes.filter(token => token.category === 'typography'); }
	return { data, dependencies: dependencies.map(item => ({ key: item.key, revision: item.revision })) };
}
