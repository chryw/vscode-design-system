/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

export function chapterContent(system) {
	if (!system.authored || system.authored.id !== system.view.section || typeof system.authored.intro !== 'string') {
		throw new Error(`Missing authored content for ${system.view.section}`);
	}
	return system.authored;
}

export function sectionContent(chapter, id) {
	const section = chapter.sections?.[id];
	if (!section || typeof section.title !== 'string' || typeof section.description !== 'string'
		|| !Array.isArray(section.paragraphs) || section.paragraphs.some(text => typeof text !== 'string')) {
		throw new Error(`Invalid authored section: ${chapter.id}, ${id}`);
	}
	return section;
}

export function contentText(template, values) {
	if (typeof template !== 'string') { throw new Error('Expected authored text'); }
	return template.replace(/\{(?<key>[a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => {
		if (!Object.hasOwn(values, key)) { throw new Error(`Missing specimen value: ${key}`); }
		return String(values[key]);
	});
}
