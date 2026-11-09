/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { node, tokenButton } from '../ui.mjs';
import { definitionEntries, designTokenGroups } from '../token-lookup.mjs';
import { motionTokenGroups } from '../motion-reference.mjs';

function tokenRow(token) {
	const row = node('tr', undefined, 'token-reference-row');
	const identity = node('th');
	identity.scope = 'row';
	identity.append(token.css ? tokenButton(token) : node('code', token.id));
	const value = node('td');
	if (/^#[\da-f]{3,8}$/i.test(token.value)) {
		const swatch = node('span', undefined, 'swatch');
		swatch.style.backgroundColor = token.value;
		swatch.setAttribute('aria-hidden', 'true');
		value.append(swatch);
	}
	value.append(node('code', token.value));
	const meaning = node('td');
	meaning.append(node('p', token.purpose));
	if (token.scope) { meaning.append(node('p', token.scope, 'meta')); }
	if (token.alias) { meaning.append(node('p', `${token.deprecated ? 'Use' : 'Alias of'} ${token.alias}`, 'meta')); }
	row.append(identity, value, meaning);
	return row;
}

export function render(target, data, host, signal) {
	const tokens = definitionEntries(data, data.view.query);
	const reference = node('section', undefined, 'article-section');
	reference.id = 'tokens-reference';
	reference.setAttribute('aria-label', 'Token reference');
	const label = node('label', 'Search tokens');
	const search = node('input');
	search.type = 'search';
	search.maxLength = 200;
	search.value = data.view.query;
	search.addEventListener('input', () => host.onSearch(search.value), { signal });
	label.append(search);
	reference.append(label);
	const list = node('div', undefined, 'token-list');
	for (const [id, values] of designTokenGroups(tokens)) {
		const guidance = data.tokenGuidance.find(domain => domain.id === id);
		if (!guidance) { throw new Error(`Missing token guidance: ${id}`); }
		const group = node('details', undefined, 'token-source-group');
		group.id = `tokens-${id}`;
		group.open = data.view.query ? true : host.groupOpen.get(id) ?? false;
		const summary = node('summary');
		summary.append(node('h2', guidance.title));
		group.append(summary);
		let mounted = false;
		const mount = () => {
			if (mounted || !group.open) { return; }
			mounted = true;
			const reference = node('div', undefined, 'token-domain-content article-section');
			reference.append(node('p', guidance.description, 'muted'));
			group.append(reference);
			const sections = id === 'motion' ? motionTokenGroups(values) : new Map([[undefined, values]]);
			for (const [title, entries] of sections) {
				if (title) { reference.append(node('h3', title)); }
				const wrapper = node('div', undefined, 'table-scroll');
				const table = node('table', undefined, 'token-reference-table');
				table.append(node('caption', guidance.title, 'sr-only'));
				const head = node('thead');
				const header = node('tr');
				for (const title of ['Token', 'Value', 'Purpose']) {
					const cell = node('th', title);
					cell.scope = 'col';
					header.append(cell);
				}
				head.append(header);
				const body = node('tbody');
				body.append(...entries.map(tokenRow));
				table.append(head, body);
				wrapper.append(table);
				reference.append(wrapper);
			}
		};
		group.addEventListener('toggle', () => {
			if (!data.view.query) { host.groupOpen.set(id, group.open); }
			mount();
		}, { signal });
		mount();
		list.append(group);
	}
	reference.append(list);
	if (!tokens.length) { reference.append(node('p', 'No matching foundation tokens')); }
	target.append(reference);
	return tokens.length;
}
