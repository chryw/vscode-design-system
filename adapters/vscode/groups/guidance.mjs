/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { withoutPresentationData } from '../../../model/documents.mjs';
import { readContent, readPage, readSpecification } from './authored.mjs';
export const files = {
	principles: ['principles'],
	typography: ['typography', 'design-tokens'],
	spacing: ['spacing', 'design-tokens'],
	shape: ['shape', 'design-tokens'],
	size: ['size', 'design-tokens', 'ux-css-layout'],
	stroke: ['design-tokens', 'ux-css-layout'],
	layout: ['design-tokens', 'ux-css-layout'],
	elevation: ['elevation', 'ux-theming'],
	colors: ['ux-theming'],
	theming: ['ux-theming'],
	iconography: ['iconography', 'design-tokens'],
	motion: ['motion'],
	accessibility: ['accessibility'],
	content: ['coding-guidelines'],
	patterns: ['hover', 'context-menus', 'accessibility'],
	tokens: [],
	components: [],
};
export function load({ read, repository }, topic) {
	if (repository.projection.mode === 'authored') {
		return topic === 'documentation' ? {} : readSpecification(read, topic, repository);
	}
	const page = topic !== 'motion' ? readPage(read, topic, repository.projection.book) : {};
	const documents = (files[topic] ?? []).map(name => {
		const file = ['principles', 'typography', 'spacing', 'shape', 'size', 'elevation', 'iconography', 'motion'].includes(name)
			? `.github/skills/design-system/foundations/${name}.design.md`
			: name === 'design-tokens' || name === 'coding-guidelines'
				? `.github/instructions/${name}.instructions.md`
				: `.github/skills/${name}/SKILL.md`;
		return { file, text: withoutPresentationData(read(file)) };
	});
	return {
		documents: { [topic]: documents },
		referenceNotes: readContent(read, 'content/foundations/source-coverage.json').topics,
		...page,
	};
}
