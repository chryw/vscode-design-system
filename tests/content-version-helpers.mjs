/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocumentCheckout } from './document-helpers.mjs';

export function createVersionCheckout(t) {
	const source = createDocumentCheckout(t);
	const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'design-content-versions-')));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const git = (root, args, input) => execFileSync('git', args, {
		cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, GIT_AUTHOR_NAME: 'Content test', GIT_AUTHOR_EMAIL: 'content@example.test',
			GIT_COMMITTER_NAME: 'Content test', GIT_COMMITTER_EMAIL: 'content@example.test' },
	}).trim();
	git(source.root, ['init', '-q', '-b', 'main']);
	const commits = new Map();
	const document = 'src/vs/feature/feature-notes.md';
	const commit = (branch, markdown) => {
		source.write(document, markdown);
		git(source.root, ['add', '--', '.github', 'src']);
		const tree = git(source.root, ['write-tree']);
		const parent = commits.get(branch) ?? commits.get('main');
		const head = git(source.root, ['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'Content version fixture\n');
		git(source.root, ['update-ref', `refs/heads/${branch}`, head]);
		commits.set(branch, head);
		return head;
	};
	commit('main', '# Remote main\n\nPublished main guidance.\n');
	const remote = path.join(directory, 'remote.git');
	git(source.root, ['clone', '--quiet', '--bare', source.root, remote]);
	git(source.root, ['remote', 'add', 'published', remote]);
	const root = path.join(directory, 'session');
	git(source.root, ['clone', '--quiet', remote, root]);
	git(root, ['update-ref', 'refs/heads/session', commits.get('main')]);
	git(root, ['symbolic-ref', 'HEAD', 'refs/heads/session']);
	writeFileSync(path.join(root, document), '# Session edit\n\nUncommitted session guidance.\n');
	return {
		root, directory, remote, home: path.join(directory, 'private-home'), document,
		read: checkout => readFileSync(path.join(checkout, document), 'utf8'),
		git: args => git(root, args),
		publish(branch, markdown) {
			const head = commit(branch, markdown);
			git(source.root, ['push', '--quiet', 'published', `refs/heads/${branch}`]);
			return head;
		},
	};
}
