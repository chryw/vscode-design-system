/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { packageRoot } from '../runtime/paths.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';

const assets = ['design-system.html', 'snapshot.json'];
const runGit = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const runGitHub = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const sha256 = content => createHash('sha256').update(content).digest('hex');

export function validateSnapshotTag(tag) {
	assert.ok(typeof tag === 'string' && /^snapshot-[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(tag)
		&& !tag.includes('..') && !tag.endsWith('.') && !tag.endsWith('.lock'), 'Use a safe snapshot tag, for example snapshot-2026-11-17');
	return tag;
}

export async function readSnapshot(directory, expectedTag) {
	const manifest = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'));
	assert.equal(manifest.format, 'vscode-design-system-snapshot');
	assert.equal(manifest.version, 1);
	validateSnapshotTag(manifest.tag);
	if (expectedTag !== undefined) { assert.equal(manifest.tag, expectedTag, 'Snapshot tag does not match the release'); }
	for (const source of [manifest.viewer, manifest.content]) {
		assert.match(source.commit, /^[a-f0-9]{40}$/);
		assert.equal(typeof source.modified, 'boolean');
	}
	assert.ok(Number.isFinite(Date.parse(manifest.createdAt)), 'Invalid snapshot timestamp');
	const html = await readFile(path.join(directory, 'design-system.html'));
	assert.equal(sha256(html), manifest.sha256, 'Snapshot HTML checksum does not match');
	return { manifest, html };
}

async function sourceFingerprint(root, output) {
	const hash = createHash('sha256').update(runGit(root, ['rev-parse', 'HEAD'])).update(runGit(root, ['diff', '--binary', 'HEAD']));
	const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
	for (const file of untracked) {
		const absolute = path.resolve(root, file);
		if (absolute === output || absolute.startsWith(`${output}${path.sep}`)) { continue; }
		hash.update(file).update(await readFile(absolute));
	}
	return hash.digest('hex');
}

async function checkRendering(file, root) {
	const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
		page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
		page.on('response', response => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); } });
		await page.goto(pathToFileURL(file).href);
		await page.waitForFunction(() => globalThis.designSnapshot?.catalog, undefined, { timeout: 30000 });
		const snapshot = await page.evaluate(() => ({
			topics: globalThis.designSnapshot.catalog.map(({ id }) => id),
			commit: globalThis.designSnapshot.commit, modified: globalThis.designSnapshot.modified,
		}));
		assert.ok(snapshot.topics.length, 'The snapshot has no chapters');
		for (const topic of snapshot.topics) {
			const url = pathToFileURL(file);
			url.searchParams.set('topic', topic);
			await page.goto(url.href);
			const article = page.locator(`article[data-topic="${topic}"][aria-busy="false"]`);
			await article.locator('h1').waitFor({ state: 'visible', timeout: 30000 });
			assert.ok((await article.locator('.topic-content').innerText()).trim(), `${topic}: empty chapter`);
			assert.equal(await article.locator('#problem:not([hidden]), [data-topic-state="error"]').count(), 0, `${topic}: render error`);
			await page.waitForFunction(() => !document.querySelector('[data-preview-state="connecting"], [data-preview-state="loading"]'), undefined, { timeout: 30000 });
			assert.deepEqual(await article.locator('[data-preview-state="unavailable"]').allTextContents(), [], `${topic}: example unavailable`);
			await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
			assert.deepEqual(errors, [], `${topic}: browser errors`);
			console.log(`Checked ${topic}`);
		}
		return snapshot;
	} finally { await browser.close(); }
}

export async function buildSnapshot({ root, output, tag }) {
	validateSnapshotTag(tag);
	assert.ok(root && output, 'Select --root <prepared VS Code checkout> and --output <new directory>');
	root = path.resolve(root);
	output = path.resolve(output);
	const repository = readRepository(root);
	assert.equal(repository.projection.mode, 'curated', 'The selected checkout has no curated design-system guidance');
	await mkdir(output);
	const before = await Promise.all([sourceFingerprint(root, output), sourceFingerprint(packageRoot, output)]);
	const run = (script, args) => execFileSync(process.execPath, [path.join(packageRoot, 'scripts', script), ...args], {
		cwd: root, stdio: 'inherit', timeout: 180000,
	});
	run('book.mjs', ['validate', '--root', root]);
	run('export.mjs', [path.join(output, 'design-system.html'), '--root', root, '--guidance-only']);
	const rendered = await checkRendering(path.join(output, 'design-system.html'), root);
	assert.deepEqual(await Promise.all([sourceFingerprint(root, output), sourceFingerprint(packageRoot, output)]), before,
		'Sources changed while building. Discard this output and retry after edits settle.');
	const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
	const manifest = {
		format: 'vscode-design-system-snapshot', version: 1, tag, createdAt: new Date().toISOString(),
		viewer: { version: metadata.version, commit: runGit(packageRoot, ['rev-parse', 'HEAD']), modified: Boolean(runGit(packageRoot, ['status', '--porcelain'])) },
		content: { commit: rendered.commit, branch: runGit(root, ['branch', '--show-current']), modified: rendered.modified },
		renderedTopics: rendered.topics.length, sha256: sha256(await readFile(path.join(output, 'design-system.html'))),
	};
	await writeFile(path.join(output, 'snapshot.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(JSON.stringify({ output, ...manifest }, null, '\t'));
	return manifest;
}

export async function publishSnapshot(directory, { repository, allowPublic = false, github = runGitHub }) {
	assert.match(repository ?? '', /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, 'Use --repository <owner>/<repo> on github.com');
	const { manifest } = await readSnapshot(directory);
	assert.equal(manifest.viewer.modified, false, 'Commit and push the validated viewer changes before publishing a snapshot');
	const api = endpoint => JSON.parse(github(['api', endpoint]));
	const checkVisibility = () => {
		const repo = api(`repos/${repository}`);
		const pages = api(`repos/${repository}/pages`);
		assert.equal(typeof repo.private, 'boolean', 'Repository visibility is unknown');
		assert.equal(typeof pages.public, 'boolean', 'Pages visibility is unknown');
		assert.equal(pages.build_type, 'workflow', 'Enable GitHub Actions in Settings → Pages before publishing');
		assert.ok(allowPublic || (repo.private && !pages.public), 'This publishes the entire snapshot publicly. Inspect the HTML, then pass --allow-public to confirm.');
		return pages;
	};
	const pages = checkVisibility();
	assert.equal(api(`repos/${repository}/commits/${manifest.viewer.commit}`).sha, manifest.viewer.commit, 'Push the viewer commit before publishing');
	const refs = api(`repos/${repository}/git/matching-refs/tags/${encodeURIComponent(manifest.tag)}`);
	assert.ok(!refs.some(ref => ref.ref === `refs/tags/${manifest.tag}`), 'Snapshot tags are immutable; choose a new tag');
	const base = new URL(pages.html_url);
	assert.equal(base.protocol, 'https:');
	if (!base.pathname.endsWith('/')) { base.pathname += '/'; }
	const url = new URL(`snapshots/${manifest.tag}/`, base).href;
	const notes = path.join(directory, 'release-notes.md');
	await writeFile(notes, `Browse this frozen design-system exploration: ${url}\n\nDownload **design-system.html** to browse offline. No VS Code or checkout is needed.\n\nContent: \`${manifest.content.commit}\`${manifest.content.modified ? ' (includes saved working changes)' : ''}.\nViewer: \`${manifest.viewer.commit}\`.\n\nThe Pages link becomes available after **Deploy snapshot releases** succeeds. This is a working exploration, not a published specification.\n`);
	github(['release', 'create', manifest.tag, '--repo', repository, '--target', manifest.viewer.commit, '--draft',
		'--prerelease', '--latest=false', '--title', manifest.tag, '--notes-file', notes,
		...assets.map(file => path.join(directory, file))]);
	const download = path.join(directory, 'uploaded');
	await mkdir(download);
	github(['release', 'download', manifest.tag, '--repo', repository, '--dir', download]);
	const uploaded = await readSnapshot(download, manifest.tag);
	assert.deepEqual(uploaded.manifest, manifest, 'Uploaded manifest changed; release remains a draft');
	checkVisibility();
	github(['release', 'edit', manifest.tag, '--repo', repository, '--draft=false']);
	const release = JSON.parse(github(['release', 'view', manifest.tag, '--repo', repository, '--json', 'url,isDraft']));
	assert.equal(release.isDraft, false, 'Release publication failed');
	console.log(JSON.stringify({ release: release.url, pages: url, deployment: 'pending GitHub Actions' }));
	return { release: release.url, pages: url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({ options: {
		root: { type: 'string' }, output: { type: 'string' }, tag: { type: 'string' }, repository: { type: 'string' },
		publish: { type: 'boolean', default: false }, 'allow-public': { type: 'boolean', default: false },
		help: { type: 'boolean', default: false },
	} });
	if (values.help) {
		console.log('Build: node scripts/release-snapshot.mjs --root <checkout> --tag snapshot-<name> --output <new directory>\nPublish reviewed output: node scripts/release-snapshot.mjs --output <directory> --publish --repository <owner/repo> [--allow-public]');
	} else {
		assert.ok(values.publish || !values.repository && !values['allow-public'], '--repository and --allow-public require --publish');
		if (values.publish) {
			assert.ok(values.output && !values.root && !values.tag, 'Publish reviewed --output without --root or --tag; build it separately first');
			await publishSnapshot(path.resolve(values.output), { repository: values.repository, allowPublic: values['allow-public'] });
		} else {
			await buildSnapshot(values);
		}
	}
}
