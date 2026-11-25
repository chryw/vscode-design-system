/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { tokenDomains } from './context.mjs';
import { findTokens } from '../model/token-definitions.mjs';
export { findTokens, definitionEntries } from '../model/token-definitions.mjs';
export { foundationReference, tokenDomains, corePaletteThemes } from './context.mjs';

export function lookupEntries(system, query = '') {
	return findTokens([...system.sizes, ...system.colors], query).map(token => ({
		id: token.id, css: token.css, value: token.value, category: token.category,
		source: token.source, alias: token.deprecated ? token.replacement : undefined,
	}));
}

export function designTokenGroups(entries, domains = tokenDomains) {
	const groups = Map.groupBy(entries, token => token.deprecated ? 'legacy' : token.group);
	return new Map(domains.filter(domain => groups.has(domain.id)).map(domain => [domain.id, groups.get(domain.id)]));
}

/** Token groups whose owning specification does not declare `tokenDomain`; the reference reports them instead of hiding them. */
export function undeclaredTokenGroups(entries, domains = tokenDomains) {
	return [...new Set(entries.map(token => token.deprecated ? 'legacy' : token.group))]
		.filter(id => !domains.some(domain => domain.id === id));
}

export function visualTokens(system, section) {
	if (section === 'spacing' || section === 'shape') {
		return system.reference.scales[section === 'spacing' ? 'spacing' : 'radii'];
	}
	const ids = {
		size: ['codiconFontSize', 'codiconFontSize.compact'],
		stroke: ['strokeThickness'],
		colors: ['editor.background', 'editor.foreground', 'descriptionForeground', 'button.background', 'button.foreground', 'focusBorder'],
	}[section] ?? [];
	const tokens = section === 'colors' ? system.colors : system.sizes;
	return ids.map(id => tokens.find(token => token.id === id)).filter(Boolean);
}
