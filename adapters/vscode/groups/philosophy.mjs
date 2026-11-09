/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function load({read}){
	const philosophyDocument = {file:'.github/skills/design-philosophy/SKILL.md',text:read('.github/skills/design-philosophy/SKILL.md')};
	const philosophyLines = philosophyDocument.text.split('\n');
	const philosophy = philosophyLines.flatMap((line, index) => {
		const match = line.match(/^#### \d+\. (?<title>.+)/);
		if (!match) {
			return [];
		}
		const question = philosophyLines.slice(index + 1, index + 5).find(line => line.startsWith('> **Ask:**'));
		if (!question) {
			throw new Error('Design Philosophy questions changed. Update the source adapter.');
		}
		return [{ title: match.groups.title, question: question.replace(/^> \*\*Ask:\*\*\s*/, '').replaceAll('*', ''), source: { file: philosophyDocument.file, line: index + 1 } }];
	});
	if (philosophy.length !== 7) {
		throw new Error('Design Philosophy principles changed. Update the source adapter.');
	}
	const philosophyValues = philosophyLines.flatMap((line, index) => {
		const match = line.match(/^\| \*\*(?<title>Calm|Focused|Consistent|Delightful)\*\* \| (?<text>[^|]+) \|/);
		return match ? [{ title: match.groups.title, text: match.groups.text.trim().replaceAll('*', ''), source: { file: philosophyDocument.file, line: index + 1 } }] : [];
	});
	if (philosophyValues.length !== 4) { throw new Error('Design Philosophy values changed. Update the source adapter.'); }
return {philosophy, philosophyValues};
}
