/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function load({ read, source, root }, selected = false) {
	const ids = Array.isArray(selected) ? selected : selected ? ['add', 'add-compact'] : undefined;
	const file = 'src/vs/base/common/codiconsLibrary.ts';
	const text = read(file);
	const dependency = path.join(root, 'node_modules/@vscode/codicons/dist');
	const codes = existsSync(path.join(dependency, 'codicon.ttf'))
		? new Set([...readFileSync(path.join(dependency, 'codicon.css'), 'utf8').matchAll(/content:\s*["']\\(?<code>[\da-f]+)["']/gi)].map(match => Number.parseInt(match.groups.code, 16)))
		: new Set();
	const icons = [...text.matchAll(/register\('(?<id>[^']+)', (?<code>0x[\da-f]+)\)/g)]
		.filter(match => !ids || ids.includes(match.groups.id))
		.map(match => ({ ...match.groups, fontAvailable: codes.has(Number.parseInt(match.groups.code, 16)), source: source(file, match.index) }));
	if (!icons.length) { throw new Error('No Codicon registrations recognized'); }
	return { icons };
}
