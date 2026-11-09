/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { install } from '../scripts/install.mjs';
import { createDocumentCheckout } from './document-helpers.mjs';

test('workspace installation contains only the viewer, stays locally ignored, and updates safely', t => {
	const { root } = createDocumentCheckout(t);
	execFileSync('git', ['init', '-q'], { cwd: root });
	const before = readFileSync(path.join(root, '.github/design-system/book.json'), 'utf8');
	const first = install(root);
	const target = first.installed;
	assert.deepEqual({
		viewer: existsSync(path.join(target, 'extension.mjs')),
		controller: existsSync(path.join(target, 'adapters/vscode/readers.mjs')),
		guidance: existsSync(path.join(target, '.github/design-system')),
		product: existsSync(path.join(target, 'src')),
		dependencies: existsSync(path.join(target, 'node_modules')),
		bookUnchanged: readFileSync(path.join(root, '.github/design-system/book.json'), 'utf8') === before,
		ignored: execFileSync('git', ['check-ignore', '.github/extensions/vscode-design-system'], { cwd: root, encoding: 'utf8' }).trim(),
		input: first.input,
	}, {
		viewer: true, controller: true, guidance: false, product: false, dependencies: false, bookUnchanged: true,
		ignored: '.github/extensions/vscode-design-system', input: { root },
	});
	assert.throws(() => install(root), /Already installed/);
	assert.deepEqual(install(root, { update: true }), first);
	appendFileSync(path.join(target, 'extension.mjs'), '\n// Local edit\n');
	assert.throws(() => install(root, { update: true }), /Installed files have changed/);
	assert.match(readFileSync(path.join(target, 'extension.mjs'), 'utf8'), /Local edit/);
});

test('installation refuses existing workspace code rather than replacing it', t => {
	const { root } = createDocumentCheckout(t);
	execFileSync('git', ['init', '-q'], { cwd: root });
	const target = path.join(root, '.github/extensions/vscode-design-system');
	mkdirSync(target, { recursive: true });
	writeFileSync(path.join(target, 'extension.mjs'), 'existing code');
	assert.throws(() => install(root, { update: true }), /unmanaged extension/);
	execFileSync('git', ['add', '.github/extensions/vscode-design-system/extension.mjs'], { cwd: root });
	assert.throws(() => install(root, { update: true }), /already tracks a canvas/);
	assert.equal(readFileSync(path.join(target, 'extension.mjs'), 'utf8'), 'existing code');
});
