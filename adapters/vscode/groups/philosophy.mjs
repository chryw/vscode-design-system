/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function load({read}){
	const file = '.github/skills/design-system/foundations/principles.design.md';
	const lines = read(file).split('\n');
	const philosophy = lines.flatMap((line, index) => {
		const match = line.match(/^#### \d+\. (?<title>.+)/);
		if (!match) {
			return [];
		}
		const question = lines.slice(index + 1, index + 5).find(line => line.startsWith('> **Ask:**'));
		if (!question) {
			throw new Error('Design principle questions changed. Update the source adapter.');
		}
		return [{ title: match.groups.title, question: question.replace(/^> \*\*Ask:\*\*\s*/, '').replaceAll('*', ''), source: { file, line: index + 1 } }];
	});
	if (philosophy.length !== 7) {
		throw new Error('Design principles changed. Update the source adapter.');
	}
	const philosophyValues = lines.flatMap((line, index) => {
		const match = line.match(/^\| \*\*(?<title>Calm|Focused|Consistent|Delightful)\*\* \| (?<text>[^|]+) \|/);
		return match ? [{ title: match.groups.title, text: match.groups.text.trim().replaceAll('*', ''), source: { file, line: index + 1 } }] : [];
	});
	if (philosophyValues.length !== 4) { throw new Error('Design values changed. Update the source adapter.'); }
return {philosophy, philosophyValues};
}
