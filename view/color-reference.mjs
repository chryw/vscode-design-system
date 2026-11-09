/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, example, tokenButton } from './ui.mjs';
import { findTokens } from './token-lookup.mjs';
import { controls } from './controls.mjs';
import { renderFixturePreview } from './components.mjs';
import { chapterContent, sectionContent } from './page-content.mjs';

const isColor = value => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) || value.startsWith('color-mix(in srgb,');
const isFoundation = token => token.definitionSource.file === 'src/vs/platform/theme/common/colors/semanticColors.ts';

function section(id, title, description) {
	const result = example(title, description);
	result.id = `colors-${id}`;
	result.tabIndex = -1;
	return result;
}

export function renderColors(content, system, host, signal) {
	const authored = chapterContent(system);
	const specimen = id => {
		const { title, description } = sectionContent(authored, id);
		return section(id, title, description);
	};
	const paragraphs = id => sectionContent(authored, id).paragraphs.map(text => node('p', text));
	const guide = node('div', undefined, 'article-flow color-guide');
	const preview = (target, id, summary) => {
		const metadata = controls.find(control => control.id === id);
		if (!metadata) { throw new Error(`Unknown color example: ${id}`); }
		const control = { ...metadata, docs: { summary } };
		const key = `colors-example:${id}`;
		const frameHost = node('div', undefined, 'color-live-example');
		target.append(frameHost);
		void renderFixturePreview(frameHost, control, host.previewState.get(key) ?? '', signal,
			patch => host.previewState.set(key, patch.fixtureId),
			{ id: `colors-example-${id}`, heading: 'h3', compact: true });
	};
	const usage = specimen('usage');
	const roles = node('dl', undefined, 'color-role-map');
	for (const [title, description] of authored.roles) {
		const item = node('div');
		item.append(node('dt', title), node('dd', description));
		roles.append(item);
	}
	usage.append(roles);
	const anatomy = node('p', undefined, 'color-token-anatomy');
	anatomy.append(node('code', 'color.background.accent'), document.createTextNode(' = color · property · purpose'));
	usage.append(anatomy, ...paragraphs('usage'));

	const surfaces = specimen('surfaces');
	preview(surfaces, ...authored.previews.surfaces);

	const accent = specimen('accent');
	accent.append(...paragraphs('accent'));
	preview(accent, ...authored.previews.accent);

	const feedback = specimen('feedback');
	const statusRoles = node('dl', undefined, 'color-role-map');
	for (const [title, description] of authored.statusRoles) {
		const item = node('div');
		item.append(node('dt', title), node('dd', description));
		statusRoles.append(item);
	}
	feedback.append(statusRoles, ...paragraphs('feedback'));
	preview(feedback, ...authored.previews.feedback);

	const states = specimen('states');
	const stateParagraphs = paragraphs('states');
	states.append(stateParagraphs[0]);
	preview(states, ...authored.previews.states);
	states.append(...stateParagraphs.slice(1));

	const inventory = specimen('palette');
	const filters = node('div', undefined, 'color-inventory-filters');
	const label = node('label', 'Search colors');
	const search = node('input');
	search.type = 'search';
	search.maxLength = 200;
	search.value = system.view.query;
	search.placeholder = 'Token name or CSS variable';
	label.append(search);
	const aliases = node('label', undefined, 'color-alias-choice');
	const includeAliases = node('input');
	includeAliases.type = 'checkbox';
	includeAliases.checked = host.previewState.get('colors-aliases') ?? Boolean(system.view.query && findTokens(system.colorCatalog, system.view.query).some(token => !isFoundation(token)));
	aliases.append(includeAliases, document.createTextNode('Include component aliases'));
	filters.append(label, aliases);
	const resultCount = node('p', undefined, 'meta');
	resultCount.setAttribute('role', 'status');
	const scroll = node('div', undefined, 'table-scroll color-matrix-scroll');
	scroll.tabIndex = 0;
	scroll.setAttribute('role', 'region');
	scroll.setAttribute('aria-label', 'Color tokens across four themes; scroll for more rows and columns');
	const table = node('table', undefined, 'color-matrix');
	const caption = node('caption', 'Unset has no specified color. Runtime-only is calculated by the product rather than this reference.');
	const head = node('thead');
	const headings = node('tr');
	for (const title of ['Token', ...system.colorPalettes.map(palette => palette.label)]) {
		const th = node('th', title);
		th.scope = 'col';
		headings.append(th);
	}
	head.append(headings);
	const body = node('tbody');
	table.append(caption, head, body);
	scroll.append(table);
	const updateList = () => {
		const colors = findTokens(system.colorCatalog, search.value).filter(token => includeAliases.checked || isFoundation(token));
		body.replaceChildren(...colors.map(token => {
			const row = node('tr');
			row.dataset.color = token.id;
			const name = node('th');
			name.scope = 'row';
			name.append(tokenButton(token));
			if (token.description) { name.append(node('p', token.description, 'meta')); }
			row.append(name);
			for (const palette of system.colorPalettes) {
				const value = token.values[palette.id].value;
				const cell = node('td');
				const chip = node('span', undefined, 'color-value-chip');
				if (isColor(value)) {
					const swatch = node('span', undefined, 'color-matrix-swatch');
					const paint = node('span', undefined, 'color-matrix-paint');
					paint.style.backgroundColor = value;
					swatch.setAttribute('aria-hidden', 'true');
					swatch.append(paint);
					chip.append(swatch);
				}
				chip.append(node('code', value));
				cell.append(chip);
				row.append(cell);
			}
			return row;
		}));
		resultCount.textContent = colors.length ? `${colors.length} ${includeAliases.checked ? 'colors' : 'usage colors'}`
			: 'No matching colors. Clear the search or include component aliases.';
		scroll.scrollTop = 0;
		return colors.length;
	};
	search.addEventListener('input', () => { host.onQuery(search.value); updateList(); }, { signal });
	includeAliases.addEventListener('change', () => { host.previewState.set('colors-aliases', includeAliases.checked); updateList(); }, { signal });
	inventory.append(filters, resultCount, scroll);
	guide.append( usage, surfaces, accent, feedback, states, inventory);
	content.append(guide);
	return updateList();
}
