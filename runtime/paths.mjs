/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const viewRoot = path.join(packageRoot, 'view');
export const workspaceRoot = process.cwd();

export function contained(root, file) {
	if (typeof file !== 'string' || !file || file.includes('\0') || path.isAbsolute(file) || /^[a-z]:/i.test(file) || file.split(/[\\/]/).includes('..')) {
		throw new Error('Source path must be repository-relative');
	}
	const target = path.resolve(root, file);
	let parent = target;
	while (!existsSync(parent)) { parent = path.dirname(parent); }
	const actual = realpathSync(parent);
	const canonical = realpathSync(root);
	if (actual !== canonical && !actual.startsWith(`${canonical}${path.sep}`)) { throw new Error('Source symlink leaves checkout'); }
	return target;
}
