/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { node, example, tokenButton } from './ui.mjs';
import { visualTokens } from './token-lookup.mjs';
import { renderFixturePreview } from './components.mjs';
import { controls } from './controls.mjs';
import { chapterContent, sectionContent } from './page-content.mjs';

function renderSpacing(content, system, host, signal) {
	const authored = chapterContent(system);
	const specimen = id => {
		const { title, description } = sectionContent(authored, id);
		return example(title, description);
	};
	const article = node('div', undefined, 'article-flow spacing-guide');
	const patterns = system.spacing.patterns;
	const grouping = specimen('grouping');
	grouping.id = 'spacing-grouping';
	const relationships = node('dl', undefined, 'spacing-relationships');
	for (const [label, text] of authored.relationships) {
		const item = node('div');
		item.append(node('dt', label), node('dd', text));
		relationships.append(item);
	}
	grouping.append(relationships);

	const product = specimen('product');
	product.id = 'spacing-product';
	const preview = node('div');
	const previous = host.previewState.get('spacing');
	const control = controls.find(item => item.id === authored.preview.control);
	if (!control) { throw new Error(`Unknown spacing example: ${authored.preview.control}`); }
	void renderFixturePreview(preview, { ...control, docs: { summary: authored.preview.summary } }, previous?.fixtureId ?? '', signal,
		patch => host.previewState.set('spacing', { fixtureId: patch.fixtureId }),
		{ id: 'spacing-example', heading: 'h3', compact: true });
	product.append(preview);

	const ramp = specimen('ramp');
	ramp.id = 'layout-spacing';
	ramp.append(...sectionContent(authored, 'ramp').paragraphs.map(text => node('p', text)));
	const table = node('table', undefined, 'spacing-token-table');
	const head = node('thead');
	const headings = node('tr');
	for (const label of ['Token', 'Value', 'To scale']) {
		const heading = node('th', label);
		heading.scope = 'col';
		headings.append(heading);
	}
	head.append(headings);
	const body = node('tbody');
	for (const token of visualTokens(system, 'spacing')) {
		const row = node('tr');
		row.dataset.scaleToken = token.id;
		const name = node('th');
		name.scope = 'row';
		name.append(tokenButton(token, token.css));
		const visual = node('td');
		const bar = node('span', undefined, 'spacing-bar');
		bar.style.width = token.value;
		bar.setAttribute('aria-hidden', 'true');
		visual.append(bar);
		row.append(name, node('td', token.value), visual);
		body.append(row);
	}
	table.append(head, body);
	ramp.append(table);

	const usage = specimen('patterns');
	usage.id = 'spacing-patterns';
	for (const pattern of patterns) {
		const row = node('article', undefined, 'spacing-pattern');
		row.dataset.spacingPattern = pattern.id;
		row.append(node('h3', pattern.title), node('p', pattern.guidance));
		usage.append(row);
	}

	const ownership = specimen('ownership');
	ownership.id = 'spacing-ownership';
	const list = node('dl', undefined, 'spacing-ownership');
	for (const [term, description] of authored.ownership) {
		list.append(node('dt', term), node('dd', description));
	}
	ownership.append(list, ...sectionContent(authored, 'ownership').paragraphs.map(text => node('p', text)));

	const responsive = specimen('responsive');
	responsive.id = 'spacing-responsive';
	responsive.append(...sectionContent(authored, 'responsive').paragraphs.map(text => node('p', text)));
	article.append(grouping, ownership, usage, product, responsive, ramp);
	content.append(article);
	return article.children.length;
}

export function renderLayout(content, system, host, signal) {
	const page = system.view.section;
	if (page === 'spacing') { return renderSpacing(content, system, host, signal); }
	const sections = node('div', undefined, 'article-flow');
	let count = 0;
	if (page === 'elevation') {
		const authored = chapterContent(system);
		const text = sectionContent(authored, 'role');
		const elevation = example(text.title, text.description);
		elevation.id = 'layout-elevation';
		for (const [role, id, note] of authored.roles) {
			const token = system.sizes.find(item => item.id === id);
			const row = node('div', undefined, 'elevation-row');
			const shape = node('span', role, 'elevation-shape');
			shape.style.borderRadius = token.value;
			const text = node('div');
			text.append(node('code', `${token.id} · ${token.value}`), node('p', note, 'meta'));
			row.append(shape, text);
			elevation.append(row);
		}
		sections.append(elevation);
		count++;
	}
	content.append(sections);
	return count;
}
