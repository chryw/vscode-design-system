/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { copilotHome } from '../../runtime/state-storage.mjs';
import { canonicalRoot } from './readers.mjs';

const execute = promisify(execFile);
const upstream = 'https://github.com/microsoft/vscode.git';

export function contentVersionSelection(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)
		|| !['latest', 'shared', 'session'].includes(input.kind)
		|| Object.keys(input).some(key => !['kind', 'branch'].includes(key))
		|| (input.kind === 'shared'
			? typeof input.branch !== 'string' || !input.branch.trim() || input.branch.length > 2048
			: input.branch !== undefined)) {
		throw new Error('Choose Latest (main), a shared branch name or GitHub branch URL, or This session.');
	}
	return input.kind === 'shared' ? { kind: input.kind, branch: input.branch.trim() } : { kind: input.kind };
}

function configuredRemote(root) {
	if (!root || !existsSync(path.join(root, '.git'))) { return upstream; }
	const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
		cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true,
	});
	if (result.error) { throw result.error; }
	if (result.status === 1) { return upstream; }
	if (result.status !== 0 || !result.stdout.trim()) { throw new Error("Couldn't read the session checkout's origin remote."); }
	const remote = result.stdout.trim();
	return /^(?:[^/\\]+@)?[^/\\]+:|^[/\\]/.test(remote) ? remote : path.resolve(root, remote);
}

function displayRemote(remote) {
	if (!/^https?:\/\//i.test(remote)) { return remote; }
	const url = new URL(remote);
	url.username = '';
	url.password = '';
	return url.href;
}

export class ContentVersions {
	constructor(sessionRoot, { home = copilotHome(), remote } = {}) {
		this.sessionRoot = sessionRoot === undefined ? undefined : canonicalRoot(sessionRoot);
		this.remote = remote ?? configuredRemote(this.sessionRoot);
		this.directory = path.join(home, 'extension-data', 'vscode-design-system', 'content');
	}
	list() {
		return [
			{ kind: 'latest', label: 'Latest (main)', description: 'Fetch the latest content from remote main.' },
			{ kind: 'shared', label: 'Shared branch…', description: 'Read a shared branch name or GitHub branch URL.' },
			{ kind: 'session', label: 'This session', available: Boolean(this.sessionRoot),
				description: this.sessionRoot ? 'Saved worktree files, including uncommitted edits.' : 'Open from a VS Code worktree to browse session files.' },
		];
	}
	local(root) {
		return { root, selection: { kind: root === this.sessionRoot ? 'session' : 'local' },
			label: root === this.sessionRoot ? 'This session' : 'Local checkout' };
	}
	source(input) {
		const selection = contentVersionSelection(input);
		let remote = this.remote;
		let ref = selection.kind === 'latest' ? 'main' : selection.branch;
		if (selection.kind === 'session') {
			if (!this.sessionRoot) { throw new Error('This session has no VS Code worktree. Open from a VS Code checkout to read session files.'); }
			return { selection, root: this.sessionRoot };
		}
		if (selection.kind === 'shared' && /^https?:\/\//i.test(ref)) {
			const url = new URL(ref);
			const match = /^\/(?<owner>[\w.-]+)\/(?<repository>[\w.-]+)\/tree\/(?<branch>.+?)\/?$/.exec(url.pathname);
			if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || !match) {
				throw new Error('Use a GitHub branch URL such as https://github.com/owner/repository/tree/branch-name.');
			}
			remote = `https://github.com/${match.groups.owner}/${match.groups.repository.replace(/\.git$/, '')}.git`;
			ref = decodeURIComponent(match.groups.branch);
		}
		ref = ref.replace(/^refs\/heads\//, '');
		if (ref.startsWith('-')) { throw new Error('Enter a valid branch name or GitHub branch URL.'); }
		const checked = spawnSync('git', ['check-ref-format', `refs/heads/${ref}`], { encoding: 'utf8', timeout: 5000, windowsHide: true });
		if (checked.error) { throw checked.error; }
		if (checked.status !== 0) { throw new Error('Enter a valid branch name or GitHub branch URL, not a commit or file URL.'); }
		return { selection, remote, ref };
	}
	async resolve(input, { signal } = {}) {
		const source = this.source(input);
		if (source.root) { return this.local(canonicalRoot(source.root)); }
		const { selection, remote, ref } = source;
		const directory = path.join(this.directory, createHash('sha256').update(remote).digest('hex'));
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (!lstatSync(directory).isDirectory()) { throw new Error('The content cache must not be a symlink.'); }
		let lock;
		try { lock = openSync(path.join(directory, 'fetch.lock'), 'wx', 0o600); }
		catch (error) {
			if (error.code === 'EEXIST') { throw new Error('Another canvas is fetching this repository. Retry when it finishes.'); }
			throw error;
		}
		const repository = path.join(directory, 'repository.git');
		const hooks = path.join(directory, 'empty-hooks');
		const git = async (args, cwd = directory) => (await execute('git', [
			'-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', ...(cwd === repository ? ['--git-dir', repository] : []), ...args,
		], {
			cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }, signal,
		})).stdout.trim();
		try {
			mkdirSync(hooks, { recursive: true });
			if (!existsSync(repository)) { await git(['init', '--bare', '--template=', repository]); }
			if (!lstatSync(repository).isDirectory()) { throw new Error('The content Git cache must not be a symlink.'); }
			await git(['fetch', '--depth=1', '--no-tags', '--no-recurse-submodules', '--', remote, `refs/heads/${ref}`], repository);
			const commit = await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], repository);
			const root = path.join(directory, 'checkouts', commit);
			if (!existsSync(root)) {
				mkdirSync(path.dirname(root), { recursive: true });
				await git(['worktree', 'add', '--detach', root, commit], repository);
			}
			if (await git(['rev-parse', 'HEAD'], root) !== commit || await git(['status', '--porcelain', '--untracked-files=normal'], root)) {
				throw new Error(`The cached content at ${root} was modified. Move it out of the cache before retrying.`);
			}
			return { root: canonicalRoot(root), selection, label: selection.kind === 'latest' ? 'Latest (main)' : 'Shared branch',
				ref, remote: displayRemote(remote), commit };
		} catch (error) {
			throw new Error(`Couldn't load ${ref}. Check the branch name, network connection, and repository access, then retry. ${error.stderr?.trim() || error.message}`, { cause: error });
		} finally {
			closeSync(lock);
			unlinkSync(path.join(directory, 'fetch.lock'));
		}
	}
}
