/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function parseJsonc(text) {
	const chars = [...text];
	let quoted = false;
	for (let index = 0; index < chars.length; index++) {
		if (quoted) {
			if (chars[index] === '\\') {
				index++;
			} else if (chars[index] === '"') {
				quoted = false;
			}
		} else if (chars[index] === '"') {
			quoted = true;
		} else if (chars[index] === '/' && ['/', '*'].includes(chars[index + 1])) {
			const block = chars[index + 1] === '*';
			chars[index++] = ' ';
			chars[index] = ' ';
			let closed = !block;
			while (++index < chars.length) {
				if (block && chars[index] === '*' && chars[index + 1] === '/') {
					chars[index++] = ' ';
					chars[index] = ' ';
					closed = true;
					break;
				}
				if (!block && chars[index] === '\n') {
					break;
				}
				if (chars[index] !== '\n' && chars[index] !== '\r') {
					chars[index] = ' ';
				}
			}
			if (!closed) {
				throw new Error('Unterminated JSONC comment');
			}
		}
	}
	quoted = false;
	for (let index = 0; index < chars.length; index++) {
		if (quoted) {
			if (chars[index] === '\\') {
				index++;
			} else if (chars[index] === '"') {
				quoted = false;
			}
		} else if (chars[index] === '"') {
			quoted = true;
		} else if (chars[index] === ',') {
			let next = index + 1;
			while (/\s/.test(chars[next] ?? '') && next < chars.length) {
				next++;
			}
			if (chars[next] === '}' || chars[next] === ']') {
				chars[index] = ' ';
			}
		}
	}
	return JSON.parse(chars.join(''));
}
