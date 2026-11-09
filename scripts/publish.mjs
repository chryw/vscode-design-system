/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas deployment tooling runs directly in Node. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { workspaceRoot, packageRoot } from '../runtime/paths.mjs';
import { copyReviewSources } from './archive.mjs';

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index++) {
	const key = args[index];
	if (!['--repository', '--account', '--checkout', '--watch', '--check', '--repository-only'].includes(key) || options.has(key)) {
		throw new Error(`Unknown or repeated option: ${key}`);
	}
	const value = ['--watch', '--check', '--repository-only'].includes(key) ? true : args[++index];
	if (!value || (typeof value === 'string' && value.startsWith('--'))) { throw new Error(`Missing value for ${key}`); }
	options.set(key, value);
}
const repository = options.get('--repository');
if (typeof repository !== 'string' || !/^(?:github\.com|microsoft\.ghe\.com)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
	throw new Error('Use --repository github.com/<owner>/<repository> or microsoft.ghe.com/<owner>/<repository>.');
}
const [host, owner, name] = repository.split('/');
const repo = `${owner}/${name}`;
const repositoryOnly = options.has('--repository-only');
const checkout = options.get('--checkout');
if (!options.has('--check') && !repositoryOnly && (typeof checkout !== 'string' || !path.isAbsolute(checkout))) {
	throw new Error('Use --checkout with an absolute path to a dedicated, existing clone of the private review repository.');
}
const environment = { ...process.env, GH_HOST: host };
if (options.has('--account')) {
	environment.GH_TOKEN = execFileSync('gh', ['auth', 'token', '--hostname', host, '--user', options.get('--account')], {
		encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
	if (!environment.GH_TOKEN) { throw new Error('The selected account has no usable CLI credential.'); }
}
const run = (command, arguments_, cwd = workspaceRoot) => execFileSync(command, arguments_, {
	cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
	env: environment,
	maxBuffer: 64 * 1024 * 1024,
});
const api = endpoint => JSON.parse(run('gh', ['api', endpoint]));
const account = api('user');
if (options.has('--account') && account.login.toLowerCase() !== options.get('--account').toLowerCase()) {
	throw new Error('The authenticated GitHub identity does not match the requested account.');
}
const metadata = api(`repos/${repo}`);
if (!metadata.private) { throw new Error('The review repository must be private.'); }
if (!repositoryOnly && metadata.owner.type !== 'Organization') {
	throw new Error('The review repository must be private and organization-owned.');
}
const pages = repositoryOnly ? undefined : api(`repos/${repo}/pages`);
if (pages && (pages.public !== false || pages.build_type !== 'workflow')) {
	throw new Error('Enable access-controlled GitHub Pages with GitHub Actions before publishing. Refusing public or legacy Pages.');
}
const reviewURL = pages?.html_url ?? `${metadata.html_url}/releases/latest`;
if (options.has('--check')) {
	console.log(JSON.stringify({ account: account.login, repository: metadata.html_url, site: reviewURL, private: true }));
	process.exit(0);
}
if (!repositoryOnly) {
	const remote = run('git', ['remote', 'get-url', 'origin'], checkout).trim();
	if (![metadata.clone_url, metadata.ssh_url].includes(remote)) {
		throw new Error('The dedicated checkout origin does not match the verified private repository.');
	}
	if (run('git', ['status', '--porcelain'], checkout).trim()) {
		throw new Error('The dedicated review checkout has local changes; resolve them before publishing.');
	}
	if (run('git', ['branch', '--show-current'], checkout).trim() !== 'main') {
		throw new Error('Use the main branch in the dedicated review checkout.');
	}
	if (run('git', ['config', '--get', 'commit.gpgsign'], checkout).trim() !== 'true') {
		throw new Error('Enable commit signing in the review checkout before publishing.');
	}
}
console.log(JSON.stringify({ repository: metadata.html_url, site: reviewURL, watch: options.has('--watch') }));

async function fingerprint() {
	const hash = createHash('sha256');
	hash.update(run('git', ['rev-parse', 'HEAD']));
	hash.update(run('git', ['diff', '--no-ext-diff', 'HEAD', '--', 'src', 'extensions', '.github/instructions', '.github/skills', 'product.json']));
	const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', 'src', 'extensions', '.github/instructions', '.github/skills'])
		.split('\0').filter(Boolean);
	for (const file of untracked.sort()) {
		hash.update(file);
		hash.update(await readFile(path.join(workspaceRoot, file)));
	}
	async function bookFiles(directory) {
		for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
			if (['node_modules', '.git', '.DS_Store'].includes(entry.name)) { continue; }
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) { await bookFiles(file); }
			else if (entry.isFile()) { hash.update(path.relative(packageRoot, file)); hash.update(await readFile(file)); }
			else { throw new Error(`Unsupported book entry: ${file}`); }
		}
	}
	await bookFiles(packageRoot);
	await bookFiles(path.join(workspaceRoot, '.github/design-system'));
	return hash.digest('hex');
}

const workflow = `name: Deploy private design book
on:
  push:
    branches: [main]
    paths: ['site/**', '.github/workflows/pages.yml']
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: private-pages
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - uses: actions/deploy-pages@v4
        id: deployment
`;

async function publishRelease(expected) {
	const tag = `snapshot-${expected}`;
	const existing = api(`repos/${repo}/releases?per_page=100`).find(release => release.tag_name === tag);
	if (existing) {
		if (existing.draft) { throw new Error(`An incomplete draft exists for ${tag}; inspect it before restarting.`); }
		console.log(JSON.stringify({ unchanged: true, review: existing.html_url, fingerprint: expected }));
		return true;
	}
	const scratch = await mkdtemp(path.join(os.tmpdir(), 'design-book-release-'));
	try {
		const snapshot = path.join(scratch, 'design-system.html');
		run(process.execPath, [fileURLToPath(new URL('./export.mjs', import.meta.url)), snapshot]);
		await copyReviewSources(scratch);
		await cp(path.join(workspaceRoot, 'LICENSE.txt'), path.join(scratch, 'LICENSE.txt'));
		const revision = {
			sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), fingerprint: expected, exportedAt: new Date().toISOString(),
		};
		await writeFile(path.join(scratch, 'revision.json'), JSON.stringify(revision, null, '\t') + '\n');
		run('tar', ['-czf', path.join(scratch, 'book-source.tar.gz'), 'book', 'repository', 'LICENSE.txt', 'revision.json'], scratch);
		if (await fingerprint() !== expected) {
			console.error('Sources changed during export; snapshot discarded. Retry after edits settle.');
			return false;
		}
		if (!api(`repos/${repo}`).private) { throw new Error('The review repository is no longer private; refusing publication.'); }
		const notes = path.join(scratch, 'notes.md');
		await writeFile(notes, `# Design-system review snapshot

Download **design-system.html**, then open it in a current browser to read the complete book and try its interactive product examples. GitHub doesn't execute HTML attachments; there is no standalone website.

This is a working draft, not a published specification. Share this release address with reviewers who have access to the private repository.

## Feedback and contributions

[Open an issue](${metadata.html_url}/issues/new) with the chapter address or topic ID, the design decision or behavior in question, and a suggested change. Attach screenshots or a patch when useful.

**book-source.tar.gz** separates the viewer and tools in **book/** from checkout-owned chapter data and source documents in **repository/**, retaining their repository-relative paths. Propose changes against their owning files and attach a patch to an issue. Executable product definitions and component fixtures remain in the author's VS Code checkout; their working changes are captured in the HTML, not included as a second product fork.

## Source revision

VS Code base commit: \`${revision.sourceCommit}\`. **revision.json** records the exact content fingerprint. Source links open the base commit; current draft product changes may differ.

The local watcher updates this repository when the book or selected product checkout changes. Updating VS Code in that checkout produces a new snapshot; it doesn't automatically fetch or merge upstream code.
`);
		const target = api(`repos/${repo}/commits/${encodeURIComponent(metadata.default_branch)}`);
		const files = ['design-system.html', 'book-source.tar.gz', 'revision.json'];
		run('gh', ['release', 'create', tag, '--repo', repository, '--draft', '--target', target.sha,
			'--title', `Design-system review ${revision.exportedAt}`, '--notes-file', notes,
			...files.map(file => path.join(scratch, file))]);
		const verification = path.join(scratch, 'download');
		await mkdir(verification);
		run('gh', ['release', 'download', tag, '--repo', repository, '--dir', verification]);
		for (const file of files) {
			const digest = data => createHash('sha256').update(data).digest('hex');
			if (digest(await readFile(path.join(scratch, file))) !== digest(await readFile(path.join(verification, file)))) {
				throw new Error(`Uploaded asset verification failed: ${file}; release remains a draft.`);
			}
		}
		if (!api(`repos/${repo}`).private) { throw new Error('Repository access changed; release remains a draft.'); }
		run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
		const release = JSON.parse(run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'url,isDraft,assets']));
		if (release.isDraft || release.assets.length !== files.length) { throw new Error('Published release verification failed.'); }
		console.log(JSON.stringify({ published: tag, review: release.url, fingerprint: expected }));
		return true;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

async function publish(expected) {
	if (repositoryOnly) { return publishRelease(expected); }
	if (run('git', ['status', '--porcelain'], checkout).trim()) { throw new Error('Review checkout changed during publishing.'); }
	const previousHead = run('git', ['rev-parse', 'HEAD'], checkout).trim();
	run('git', ['pull', '--ff-only'], checkout);
	if (run('git', ['rev-parse', 'HEAD'], checkout).trim() !== previousHead) {
		throw new Error('The remote review repository changed. Review and integrate contributions before restarting the publisher.');
	}
	const scratch = await mkdtemp(path.join(os.tmpdir(), 'design-book-publish-'));
	try {
		const snapshot = path.join(scratch, 'index.html');
		run(process.execPath, [fileURLToPath(new URL('./export.mjs', import.meta.url)), snapshot]);
		if (await fingerprint() !== expected) {
			console.error('Sources changed during export; snapshot discarded. Retry after edits settle.');
			return false;
		}
		// Recheck access control for each publication, not only when the watcher starts.
		if (api(`repos/${repo}/pages`).public !== false || !api(`repos/${repo}`).private) {
			throw new Error('Review access control changed; refusing publication.');
		}
		await mkdir(path.join(checkout, 'site'), { recursive: true });
		await mkdir(path.join(checkout, '.github/workflows'), { recursive: true });
		await cp(snapshot, path.join(checkout, 'site/index.html'));
		await writeFile(path.join(checkout, '.github/workflows/pages.yml'), workflow);
		await writeFile(path.join(checkout, 'site/revision.json'), JSON.stringify({
			sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), fingerprint: expected, exportedAt: new Date().toISOString(),
		}, null, '\t') + '\n');
		await writeFile(path.join(checkout, 'README.md'), `# Visual Studio Code design-system review

[Read the private book](${pages.html_url})

This is a working draft with interactive examples from the product source. It isn't a published specification. Repository read access controls website access.

## Feedback and contributions

[Open an issue](${metadata.html_url}/issues/new) with the chapter address, the decision or behavior in question, and a suggested change. Use screenshots when they explain the issue.

The book and product files remain canonical in the author's VS Code checkout. Propose content or implementation changes against the owning file linked in the book; attach a patch to an issue when the working branch isn't yet published. Don't edit the generated website.

## Updates

The author's publisher rebuilds the full book and its product fixtures when the book or selected checkout changes, then commits a snapshot here. GitHub Actions deploys that snapshot without requiring internal npm-feed credentials in CI. A VS Code update is picked up when the author's checkout advances; this repository doesn't modify or merge that checkout automatically.

[Snapshot revision](site/revision.json) records the source commit and content fingerprint. Local product changes can differ from the source links at the base commit.
`);
		run('git', ['add', '--', 'site/index.html', 'site/revision.json', '.github/workflows/pages.yml', 'README.md'], checkout);
		run('git', ['commit', '-m', 'Update design-system review snapshot\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'], checkout);
		const candidate = run('git', ['rev-parse', 'HEAD'], checkout).trim();
		run('git', ['verify-commit', candidate], checkout);
		run('git', ['push', 'origin', 'HEAD:main'], checkout);
		const published = api(`repos/${repo}/commits/main`);
		if (published.sha !== candidate || !published.commit.verification.verified || published.commit.verification.reason !== 'valid') {
			throw new Error(`Remote head/signature verification failed for ${candidate}; inspect the repository before continuing.`);
		}
		console.log(JSON.stringify({ published: candidate, site: pages.html_url, fingerprint: expected }));
		return true;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

let previous;
const initial = await fingerprint();
if (await publish(initial)) { previous = initial; }
else if (!options.has('--watch')) { throw new Error('Sources changed during export; rerun after edits settle.'); }
if (options.has('--watch')) {
	let stopping = false;
	for (const signal of ['SIGINT', 'SIGTERM']) { process.once(signal, () => { stopping = true; }); }
	while (!stopping) {
		await new Promise(resolve => setTimeout(resolve, 30000));
		if (stopping) { break; }
		const next = await fingerprint();
		if (next === previous) { continue; }
		await new Promise(resolve => setTimeout(resolve, 5000));
		if (stopping || await fingerprint() !== next) { continue; }
		if (await publish(next)) { previous = next; }
	}
}
