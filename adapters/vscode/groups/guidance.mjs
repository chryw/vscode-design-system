/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readContent, readPage } from './authored.mjs';
export const files = {
	principles: ['design-philosophy'],
	typography: ['design-philosophy', 'design-tokens'],
	spacing: ['design-philosophy', 'design-tokens'],
	shape: ['design-philosophy', 'design-tokens'],
	size: ['design-philosophy', 'design-tokens', 'ux-css-layout'],
	stroke: ['design-tokens', 'ux-css-layout'],
	layout: ['design-tokens', 'ux-css-layout'],
	elevation: ['design-philosophy', 'ux-theming'],
	colors: ['ux-theming'],
	theming: ['ux-theming'],
	iconography: ['design-philosophy', 'design-tokens'],
	motion: ['design-philosophy'],
	accessibility: ['accessibility'],
	content: ['coding-guidelines'],
	patterns: ['hover', 'context-menus', 'accessibility'],
	tokens: [],
	components: [],
};
export function load({ read }, topic) {
	const documents = (files[topic] ?? []).map(name => {
		const file = name === 'design-tokens' || name === 'coding-guidelines'
			? `.github/instructions/${name}.instructions.md` : `.github/skills/${name}/SKILL.md`;
		let text = read(file);
		if (!['accessibility', 'content', 'patterns', 'principles'].includes(topic)) {
			const anchors = {
				typography: ['type-ramp', 'icon-sizes'], spacing: ['spacing-ramp'], shape: ['elevation-tiers'],
				size: ['icon-sizes', 'one-stroke'], stroke: ['one-stroke'], motion: ['reveal-on-intent'],
				layout: [], elevation: ['elevation-tiers'],
			}[topic] ?? [];
			if (name === 'design-philosophy' && anchors.length) {
				const chunks = anchors.map(anchor => {
					const start = text.indexOf(`<a id="${anchor}">`);
					if (start < 0) { throw new Error(`Guidance anchor changed: ${anchor}`); }
					const end = text.indexOf('\n<a id=', start + 1);
					return text.slice(start, end < 0 ? undefined : end);
				});
				text = chunks.join('\n');
			}
		}
		return { file, text };
	});
	return {
		documents: { [topic]: documents },
		referenceNotes: readContent(read, 'content/foundations/source-coverage.json').topics,
		...(topic !== 'motion' ? readPage(read, topic) : {}),
	};
}
