/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../runtime/paths.mjs';
import { canonicalRoot } from '../runtime/store.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--root') {
	throw new Error('Usage: node scripts/test.mjs --root <VS Code checkout>');
}
const root = canonicalRoot(args[1]);
const tests = readdirSync(path.join(packageRoot, 'tests'))
	.filter(file => file.endsWith('.test.mjs')).map(file => path.join(packageRoot, 'tests', file));
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) { throw result.error; }
if (result.signal) { throw new Error(`Tests terminated by ${result.signal}`); }
process.exitCode = result.status;
