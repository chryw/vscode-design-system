/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, example } from './ui.mjs';
import { corePaletteThemes } from './token-lookup.mjs';
import { chapterContent, sectionContent } from './page-content.mjs';

export function renderThemeGallery(content, system) {
	const authored = chapterContent(system);
	const core = new Set(corePaletteThemes.map(theme => theme.id));
	const comparisons = [
		...corePaletteThemes.flatMap(({ id }) => system.themeGallery.filter(theme => theme.id === id)),
		...system.themeGallery.filter(theme => !core.has(theme.id)),
	];
	const group = node('div', undefined, 'theme-comparisons');
	for (const theme of comparisons) {
		const p = theme.palette;
		const figure = node('figure', undefined, 'theme-comparison');
		figure.dataset.theme = theme.id;
		const sample = node('div', undefined, 'theme-semantic-example');
		sample.style.backgroundColor = p.editor;
		sample.style.color = p.foreground;
		sample.style.borderColor = p.border === 'none' ? 'transparent' : p.border;
		const heading = node('h3', theme.id);
		const body = node('p', authored.specimen);
		const action = node('div', undefined, 'theme-accent-example');
		const swatch = node('span', undefined, 'theme-accent-swatch');
		swatch.style.backgroundColor = p.accent;
		swatch.setAttribute('aria-hidden', 'true');
		action.append(swatch, node('span', 'Accent'));
		sample.append(heading, body, action);
		const caption = node('figcaption');
		caption.append(node('span', 'Surface · text · accent', 'meta'));
		figure.append(sample, caption);
		group.append(figure);
	}
	const guidanceText = sectionContent(authored, 'guidance');
	const comparisonText = sectionContent(authored, 'comparison');
	const guidance = example(guidanceText.title, guidanceText.description);
	const examples = example(comparisonText.title, comparisonText.description);
	examples.append(group);
	content.append(guidance, examples);
	return comparisons.length;
}
