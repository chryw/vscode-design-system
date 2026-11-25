/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentVersions } from '../adapters/vscode/content-versions.mjs';
import { createBookRuntime } from '../runtime/lifecycle.mjs';
import { createVersionCheckout } from './content-version-helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('remote versions fetch current main and unlisted shared branches without changing the session checkout', async t => {
	const fixture = createVersionCheckout(t);
	const versions = new ContentVersions(fixture.root, { home: fixture.home });
	const before = {
		head: fixture.git(['rev-parse', 'HEAD']), branch: fixture.git(['symbolic-ref', 'HEAD']),
		index: fixture.git(['write-tree']), status: fixture.git(['status', '--porcelain']),
		refs: fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']), markdown: fixture.read(fixture.root),
	};
	const latest = await versions.resolve({ kind: 'latest' });
	const nextCommit = fixture.publish('main', '# Updated main\n\nNew remote guidance.\n');
	const updated = await versions.resolve({ kind: 'latest' });
	fixture.publish('design/shared-guidance', '# Shared guidance\n\nA teammate branch.\n');
	const shared = await versions.resolve({ kind: 'shared', branch: 'design/shared-guidance' });
	const session = await versions.resolve({ kind: 'session' });
	assert.deepEqual({
		initial: fixture.read(latest.root), updated: fixture.read(updated.root), currentCommit: updated.commit,
		shared: fixture.read(shared.root), session: session.root,
		unchanged: {
			head: fixture.git(['rev-parse', 'HEAD']), branch: fixture.git(['symbolic-ref', 'HEAD']),
			index: fixture.git(['write-tree']), status: fixture.git(['status', '--porcelain']),
			refs: fixture.git(['for-each-ref', '--format=%(refname) %(objectname)']), markdown: fixture.read(fixture.root),
		},
	}, {
		initial: '# Remote main\n\nPublished main guidance.\n', updated: '# Updated main\n\nNew remote guidance.\n', currentCommit: nextCommit,
		shared: '# Shared guidance\n\nA teammate branch.\n', session: fixture.root, unchanged: before,
	});
});

test('source-only remote versions leave unrelated LFS assets as pointers without fetching them', async t => {
	const fixture = createVersionCheckout(t);
	const versions = new ContentVersions(fixture.root, { home: fixture.home });
	const initial = await versions.resolve({ kind: 'latest' });
	const repository = path.resolve(initial.root, '../../repository.git');
	const configure = (key, value) => execFileSync('git', ['--git-dir', repository, 'config', key, value]);
	configure('filter.docs-lfs-test.smudge', `${JSON.stringify(process.execPath)} -e ${JSON.stringify("if (!process.env.GIT_LFS_SKIP_SMUDGE) process.exit(7); process.stdin.pipe(process.stdout);")}`);
	configure('filter.docs-lfs-test.clean', `${JSON.stringify(process.execPath)} -e ${JSON.stringify('process.stdin.pipe(process.stdout);')}`);
	configure('filter.docs-lfs-test.required', 'true');
	fixture.write('src/.gitattributes', 'unrelated-asset filter=docs-lfs-test\n');
	const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 100\n';
	fixture.write('src/unrelated-asset', pointer);
	fixture.publish('main', '# Main with an unrelated large asset\n');
	const selected = await versions.resolve({ kind: 'latest' });
	assert.deepEqual({
		markdown: fixture.read(selected.root),
		asset: readFileSync(path.join(selected.root, 'src/unrelated-asset'), 'utf8'),
	}, { markdown: '# Main with an unrelated large asset\n', asset: pointer });
});

test('shared URLs retain slash-containing and encoded branch names while invalid sources fail before fetching', async t => {
	const fixture = createVersionCheckout(t);
	const versions = new ContentVersions(fixture.root, { home: fixture.home });
	const branch = 'https://github.com/team/vscode/tree/design%2Fshared-guidance';
	assert.deepEqual(versions.source({ kind: 'shared', branch }), {
		selection: { kind: 'shared', branch }, remote: 'https://github.com/team/vscode.git', ref: 'design/shared-guidance',
	});
	for (const value of [
		'https://example.com/team/vscode/tree/main', 'https://github.com/team/vscode/blob/main/README.md',
		'https://user:password@github.com/team/vscode/tree/main', '--upload-pack=bad', '../outside', 'main~1',
	]) {
		assert.throws(() => versions.source({ kind: 'shared', branch: value }), /branch name|branch URL/);
	}
	await assert.rejects(versions.resolve({ kind: 'shared', branch: 'missing-branch' }), /Couldn't load missing-branch/);
	assert.equal((await versions.resolve({ kind: 'latest' })).selection.kind, 'latest');
});

test('the panel switches content versions transactionally and restores its session origin after provider recreation', async t => {
	const fixture = createVersionCheckout(t);
	fixture.publish('design/shared-guidance', '# Shared guidance\n\nA teammate branch.\n');
	const runtime = createBookRuntime(fixture.root, { home: fixture.home });
	t.after(() => runtime.close('book'));
	await runtime.open('book', { active: 'documentation' });
	const panel = runtime.required('book');
	const origin = new URL(panel.url).origin;
	const post = async input => fetch(`${origin}/api/content-version`, {
		method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input),
	});
	const response = await post({ kind: 'shared', branch: 'design/shared-guidance' });
	assert.equal(response.status, 200);
	const font = await fetch(new URL('/codicon.ttf', panel.url));
	assert.equal(font.status, 200, 'a dependency-free content checkout retains the viewer icon font');
	const selected = panel.root;
	panel.setView({ theme: 'Light 2026' });
	const failed = await post({ kind: 'shared', branch: 'missing-branch' });
	assert.deepEqual({ status: failed.status, sameRoot: panel.root === selected, theme: panel.view.theme, origin: new URL(panel.url).origin },
		{ status: 400, sameRoot: true, theme: 'Light 2026', origin });
	await runtime.close('book');
	fixture.publish('design/shared-guidance', '# Revised shared guidance\n\nA newer teammate commit.\n');
	await runtime.open('book');
	const reopened = runtime.required('book');
	const restored = await (await fetch(new URL('/api/checkouts', reopened.url))).json();
	assert.deepEqual({
		selection: restored.contentVersion.selection, theme: reopened.view.theme,
		session: restored.versions.find(item => item.kind === 'session').available, markdown: fixture.read(reopened.root),
	}, {
		selection: { kind: 'shared', branch: 'design/shared-guidance' }, theme: 'Light 2026', session: true,
		markdown: '# Revised shared guidance\n\nA newer teammate commit.\n',
	});
	await reopened.selectContentVersion({ kind: 'session' });
	assert.equal(fixture.read(reopened.root), '# Session edit\n\nUncommitted session guidance.\n');
});

test('an explicit opening checkout remains the session source after remote selection and provider recreation outside the repository', async t => {
	const fixture = createVersionCheckout(t);
	const runtime = createBookRuntime(fixture.directory, { home: fixture.home });
	t.after(() => runtime.close('explicit'));
	await runtime.open('explicit', { root: fixture.root, active: 'documentation' });
	await runtime.required('explicit').selectContentVersion({ kind: 'latest' });
	await runtime.close('explicit');
	await runtime.open('explicit');
	await runtime.required('explicit').selectContentVersion({ kind: 'session' });
	assert.deepEqual({ root: runtime.rootFor('explicit'), markdown: fixture.read(runtime.rootFor('explicit')) },
		{ root: fixture.root, markdown: '# Session edit\n\nUncommitted session guidance.\n' });
});

test('a reader outside a VS Code session defaults to freshly fetched main without inventing a session worktree', async t => {
	const fixture = createVersionCheckout(t);
	const runtime = createBookRuntime(fixture.directory, { home: fixture.home, remote: fixture.remote });
	t.after(() => runtime.close('reader'));
	await runtime.open('reader', { active: 'documentation' });
	const panel = runtime.required('reader');
	const result = await (await fetch(new URL('/api/checkouts', panel.url))).json();
	assert.deepEqual({
		markdown: fixture.read(panel.root), selection: result.contentVersion.selection,
		session: result.versions.find(item => item.kind === 'session').available,
	}, { markdown: '# Remote main\n\nPublished main guidance.\n', selection: { kind: 'latest' }, session: false });
	await assert.rejects(panel.selectContentVersion({ kind: 'session' }), /no VS Code worktree/);
});
