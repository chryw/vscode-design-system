/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import {node,example} from './ui.mjs';
import {chapterContent, sectionContent} from './page-content.mjs';
import {markdown} from './markdown.mjs';

export function renderSimplePage(content, system) {
	const page = system.view.section;
	if (page === 'patterns') {
		for (const document of system.documents[page]) { content.append(markdown(document.text, 2)); }
		return system.documents[page].length;
	}
	if (page === 'accessibility' || page === 'content') {
		const order = chapterContent(system).headingOrder.map(title => title.toLowerCase());
		const sections = [];
		for (const document of system.documents[page]) {
			const lines = document.text.split('\n');
			let found = false;
			for (let index = 0; index < lines.length; index++) {
				const heading = lines[index].match(/^(#{1,4})\s+(.+)/);
				if (!heading) { continue; }
				const priority = order.findIndex(title => heading[2].toLowerCase().includes(title));
				if (priority < 0) { continue; }
				found = true;
				let end = index + 1;
				while (end < lines.length && !new RegExp(`^#{1,${heading[1].length}} `).test(lines[end])) { end++; }
				let fenced = false;
				const text = lines.slice(index, end).filter(line => {
					if (/^\s*```/.test(line)) { fenced = !fenced; return false; }
					return !fenced;
				}).join('\n');
				sections.push({ priority, text });
			}
			if (!found) {
				throw new Error(`Guidance headings changed in ${document.file}; update the source adapter.`);
			}
		}
		content.append(markdown(sections.sort((a, b) => a.priority - b.priority).map(section => section.text).join('\n\n'), 2));
		return content.children.length;
	}
	if (page !== 'principles') {
		content.append(node('p', 'Documentation and examples are not available yet.', 'reference-empty'));
		return 0;
	}
	const entries = system.philosophyValues;
	const grid = node('div', undefined, 'visual-flow');
	for (const entry of entries) { grid.append(example(entry.title, entry.text)); }
	content.append(grid);
	if (page === 'principles') {
		const principles = node('section', undefined, 'philosophy-principles');
		const practice = sectionContent(chapterContent(system), 'practice');
		principles.append(node('h2', practice.title),
			node('p', practice.description, 'muted'));
		for (const principle of system.philosophy) {
			const item = node('article');
			item.append(node('h3', principle.title), node('p', principle.question));
			principles.append(item);
		}
		content.append(principles);
	}
	return entries?.length ?? 0;
}
