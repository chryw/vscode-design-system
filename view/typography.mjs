/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, example, exampleViewer } from './ui.mjs';
import { chapterContent, sectionContent, contentText } from './page-content.mjs';

const platform = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'linux';

function roleLabel(token) {
	const role = token.id.split('.').at(-1).replace(/([a-z])(\d)/g, '$1 $2').replace('semiBold', 'semibold');
	return role[0].toUpperCase() + role.slice(1);
}

function section(id, title, description) {
	const element = example(title, description);
	element.classList.add('typography-section');
	element.id = `typography-${id}`;
	element.tabIndex = -1;
	return element;
}

export function renderTypography(content, system) {
	const authored = chapterContent(system);
	const sampleText = authored.sampleText;
	const specimen = id => {
		const { title, description } = sectionContent(authored, id);
		return section(id, title, description);
	};
	const model = system.typography;
	const roles = system.reference.scales.typeRoles;
	const weights = system.reference.scales.weights;
	const families = specimen('families');
	const familyCards = node('div', undefined, 'typography-families');
	families.append(familyCards);
	const specimens = specimen('styles');
	const rows = node('div', undefined, 'typography-style-list');
	for (const token of roles) {
		const row = node('article', undefined, 'typography-style-row');
		row.dataset.token = token.id;
		const role = token.id.replace('fontSize.', '');
		const strong = role.startsWith('heading');
		const preview = node('p', sampleText, 'typography-specimen');
		preview.style.fontSize = token.value;
		preview.style.fontWeight = weights.find(weight => weight.id === `fontWeight.${strong ? 'semiBold' : 'regular'}`).value;
		const meta = node('div', undefined, 'typography-style-meta');
		const identity = node('div', undefined, 'tools type-role-identity');
		identity.append(node('span', roleLabel(token), 'type-role-name'), node('code', `${token.value} · ${strong ? weights.find(weight => weight.id === 'fontWeight.semiBold').value : weights.find(weight => weight.id === 'fontWeight.regular').value}`));
		meta.append(identity, node('p', token.description, 'meta'));
		row.append(meta, preview);
		rows.append(row);
	}
	specimens.append(rows);
	const emphasis = specimen('emphasis');
	const emphasisGrid = node('div', undefined, 'typography-emphasis reference-specimen');
	for (const token of weights) {
		const item = node('div', undefined, 'font-weight-example');
		item.append(node('h3', roleLabel(token)));
		const preview = node('p', sampleText, 'typography-weight-specimen');
		preview.style.fontSize = model.tokens.find(token => token.id === 'fontSize.body1').value;
		preview.style.fontWeight = token.value;
		item.append(preview, node('code', token.value));
		emphasisGrid.append(item);
	}
	emphasis.append(exampleViewer(emphasisGrid));
	const composition = specimen('composition');
	const compositionSample = node('div', undefined, 'typography-composition reference-specimen');
	compositionSample.style.lineHeight = model.baseline.lineHeight;
	for (const [id, text] of authored.composition) {
		const token = model.tokens.find(token => token.id === id);
		if (!token) { throw new Error(`Unknown typography specimen token: ${id}`); }
		const line = node('p', text);
		line.style.fontSize = token.value;
		line.style.fontWeight = id.includes('heading') ? '600' : '400';
		compositionSample.append(line);
	}
	composition.append(exampleViewer(compositionSample), node('p', contentText(authored.baseline, model.baseline), 'meta'));
	const metrics = system.reference.scales.readingMetrics.length
		? specimen('metrics')
		: undefined;
	for (const token of system.reference.scales.readingMetrics) {
		metrics.append(node('p', `${token.description} · ${token.value}`));
	}
	const locales = node('section', undefined, 'article-section');
	locales.id = 'typography-reference';
	locales.append(node('h3', 'Locale fallbacks'));
	for (const family of model.families.filter(family => family.locale !== 'Default').slice(0, 2)) {
		const line = node('p');
		line.append(node('strong', `${family.platform} · ${family.locale}: `), node('code', family.value));
		line.lang = family.locale;
		locales.append(line);
	}
	families.append(locales, ...sectionContent(authored, 'families').paragraphs.map(text => node('p', text, 'meta')));
	content.append(composition, emphasis, specimens, ...(metrics ? [metrics] : []), families);

	function updateFamilies() {
		const selected = model.families.filter(family => family.locale === 'Default');
		const ui = selected.find(family => family.platform === platform && family.property === 'font-family');
		familyCards.replaceChildren(...selected.map(family => {
			const item = node('div', undefined, 'font-family-example');
			item.append(node('h3', `${family.platform} · ${family.property === 'font-family' ? 'Interface' : 'Monospace'}`), node('code', family.value));
			const preview = node('p', family.property === 'font-family' ? 'Interface Aa 0123' : 'const value = 42;', 'font-family-inline');
			preview.style.fontFamily = family.value;
			item.append(preview);
			return item;
		}));
		for (const target of [rows, emphasisGrid, compositionSample]) {
			target.style.fontFamily = ui.value;
		}
	}
	updateFamilies();
	return model.tokens.length;
}
