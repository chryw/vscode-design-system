/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const git = (root, args) => execFileSync('git', args, {
	cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,
});

export function checkoutRevision(root) {
	const head = path.resolve(root, git(root, ['rev-parse', '--git-path', 'HEAD']).trim());
	return `${readFileSync(head, 'utf8')}:${git(root, ['rev-parse', '--revs-only', 'HEAD']).trim()}`;
}

export function listCheckouts(root) {
	const records = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean);
	return records.map(record => {
		const fields = record.split('\0');
		const checkout = fields.find(field => field.startsWith('worktree '))?.slice(9);
		const branch = fields.find(field => field.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') ?? 'Detached HEAD';
		if (!checkout) { throw new Error('Git returned an invalid worktree record'); }
		return { root: checkout, branch, current: checkout === root };
	});
}
