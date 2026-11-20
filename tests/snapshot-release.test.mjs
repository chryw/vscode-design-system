/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildSnapshot, publishSnapshot, readSnapshot, sha256, validateSnapshotTag } from '../scripts/release-snapshot.mjs';
import { buildSnapshotPages, snapshotSourceHTML } from '../scripts/build-snapshot-pages.mjs';
import { linkSnapshotRelease } from '../scripts/link-snapshot-release.mjs';

async function snapshot(root, tag, text, overrides = {}) {
	const directory = path.join(root, tag);
	await mkdir(directory);
	await writeFile(path.join(directory, 'design-system.html'), text);
	const manifest = {
		format: 'vscode-design-system-snapshot', version: 1, tag, createdAt: '2026-11-17T00:00:00Z',
		viewer: { version: 'test', commit: 'a'.repeat(40), modified: false },
		content: { commit: 'b'.repeat(40), branch: 'exploration', modified: true },
		renderedTopics: 1, sha256: sha256(text), ...overrides,
	};
	await writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(manifest));
	return { directory, manifest };
}

test('snapshot tags and checksums reject traversal, mismatched tags, and corrupted HTML', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-integrity-'));
	try {
		for (const tag of ['../snapshot-bad', 'snapshot-../bad', 'snapshot-..', 'snapshot-name.lock', 'snapshot-x/../../y']) {
			assert.throws(() => validateSnapshotTag(tag), /safe snapshot tag/);
		}
		const { directory } = await snapshot(root, 'snapshot-safe', '<h1>Book</h1>');
		await assert.rejects(readSnapshot(directory, 'snapshot-other'), /does not match the release/);
		await writeFile(path.join(directory, 'design-system.html'), '<h1>Changed</h1>');
		await assert.rejects(readSnapshot(directory), /checksum does not match/);
		const dirty = await snapshot(root, 'snapshot-dirty', 'Working renderer', {
			viewer: { version: 'test', commit: 'a'.repeat(40), modified: true },
		});
		await assert.rejects(publishSnapshot(dirty.directory, {
			repository: 'team/book', github: () => { throw new Error('Must not contact GitHub for a dirty viewer'); },
		}), /Commit and push/);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('snapshot builds reject source-library checkouts before creating output', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-basic-'));
	try {
		const output = path.join(root, 'output');
		await assert.rejects(buildSnapshot({ root, output, tag: 'snapshot-basic' }), /no curated design-system guidance/);
		await assert.rejects(readFile(path.join(output, 'snapshot.json')), { code: 'ENOENT' });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Pages retains old snapshots and chooses the newest publication without lexical tag ordering', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-site-'));
	try {
		const html = title => `<h1>${title}</h1><script id="snapshot-payload" type="application/json">${JSON.stringify({
			snapshot: gzipSync(JSON.stringify({ catalog: [{ id: 'principles' }] })).toString('base64'),
		})}</script>`;
		const oldHTML = html('Old');
		const latestHTML = html('New');
		const old = await snapshot(root, 'snapshot-z-old', oldHTML);
		const latest = await snapshot(root, 'snapshot-a-new', latestHTML);
		const release = (tag, date) => ({ tag_name: tag, published_at: date, draft: false,
			assets: [{ name: 'design-system.html' }, { name: 'snapshot.json' }] });
		const releases = [
			release('snapshot-z-old', '2026-11-15T00:00:00Z'), release('snapshot-a-new', '2026-11-17T00:00:00Z'),
			{ tag_name: 'v1', draft: false }, { tag_name: 'snapshot-draft', draft: true },
		];
		const github = args => {
			if (args[0] === 'api') { return JSON.stringify([releases]); }
			assert.deepEqual(args.slice(0, 2), ['release', 'download']);
			cpSync(args[2] === old.manifest.tag ? old.directory : latest.directory, args[args.indexOf('--dir') + 1], { recursive: true });
			return '';
		};
		const output = path.join(root, 'site');
		await buildSnapshotPages({ repository: 'team/book', output, github });
		assert.deepEqual({
			latest: snapshotSourceHTML(await readFile(path.join(output, 'index.html'), 'utf8')),
			old: snapshotSourceHTML(await readFile(path.join(output, 'snapshots/snapshot-z-old/index.html'), 'utf8')),
			new: snapshotSourceHTML(await readFile(path.join(output, 'snapshots/snapshot-a-new/index.html'), 'utf8')),
			versions: await readdir(path.join(output, 'snapshots')),
		}, { latest: latestHTML, old: oldHTML, new: latestHTML, versions: ['snapshot-a-new', 'snapshot-z-old'] });
		const hosted = await readFile(path.join(output, 'snapshots/snapshot-z-old/index.html'), 'utf8');
		const index = JSON.parse(hosted.split('data-base="../../">')[1].split('</script>')[0]);
		assert.deepEqual(index, {
			current: 'snapshot-z-old', latest: 'snapshot-a-new',
			versions: [
				{ tag: 'snapshot-a-new', label: 'snapshot-a-new', topics: ['principles'] },
				{ tag: 'snapshot-z-old', label: 'snapshot-z-old', topics: ['principles'] },
			],
		});
		await writeFile(path.join(latest.directory, 'design-system.html'), 'Corrupted');
		await assert.rejects(buildSnapshotPages({ repository: 'team/book', output: path.join(root, 'bad-site'), github }), /checksum/);
		await assert.rejects(readFile(path.join(root, 'bad-site/index.html')), { code: 'ENOENT' });
		assert.equal(snapshotSourceHTML(await readFile(path.join(output, 'index.html'), 'utf8')), latestHTML);
		await writeFile(path.join(latest.directory, 'design-system.html'), latestHTML);
		releases[0].assets = [];
		await assert.rejects(buildSnapshotPages({ repository: 'team/book', output: path.join(root, 'missing-site'), github }), /missing design-system.html/);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('hosted navigation preserves the immutable source and rejects malformed marker blocks', () => {
	const start = '<!-- snapshot-version-navigation:start -->';
	const end = '<!-- snapshot-version-navigation:end -->';
	assert.equal(snapshotSourceHTML(`<body>Book${start}<script>Navigation</script>${end}</body>`), '<body>Book</body>');
	for (const html of [`${start}Book`, `${end}Book`, `${end}${start}`, `${start}${start}${end}`]) {
		assert.throws(() => snapshotSourceHTML(html), /Invalid hosted snapshot navigation markers/);
	}
});

test('publishing requires public consent and an unused tag; uploaded assets verify before publication', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-publish-'));
	try {
		const { directory, manifest } = await snapshot(root, 'snapshot-release', '<h1>Verified</h1>');
		const operations = [];
		let existing = false;
		const github = args => {
			operations.push(args);
			if (args[0] === 'api') {
				if (args[1].endsWith('/pages')) { return JSON.stringify({ public: true, build_type: 'workflow', html_url: 'https://team.github.io/book/' }); }
				if (args[1].includes('/commits/')) { return JSON.stringify({ sha: manifest.viewer.commit }); }
				if (args[1].includes('/matching-refs/')) { return JSON.stringify(existing ? [{ ref: `refs/tags/${manifest.tag}` }] : []); }
				return JSON.stringify({ private: false });
			}
			if (args[1] === 'download') {
				const destination = args[args.indexOf('--dir') + 1];
				for (const name of ['design-system.html', 'snapshot.json']) { cpSync(path.join(directory, name), path.join(destination, name)); }
			}
			if (args[1] === 'view') { return JSON.stringify({ url: 'https://github.com/team/book/releases/tag/snapshot-release', isDraft: false }); }
			return '';
		};
		await assert.rejects(publishSnapshot(directory, { repository: 'team/book', github }), /--allow-public/);
		assert.ok(operations.every(args => args[0] === 'api'));
		existing = true;
		await assert.rejects(publishSnapshot(directory, { repository: 'team/book', allowPublic: true, github }), /immutable/);
		existing = false;
		operations.length = 0;
		const result = await publishSnapshot(directory, { repository: 'team/book', allowPublic: true, github });
		assert.deepEqual({ ...result, operations: operations.filter(args => args[0] === 'release').map(args => args[1]),
			draft: operations.find(args => args[1] === 'create').includes('--draft') },
		{ release: 'https://github.com/team/book/releases/tag/snapshot-release', pages: 'https://team.github.io/book/snapshots/snapshot-release/',
			operations: ['create', 'download', 'edit', 'view'], draft: true });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('failed upload verification leaves the release as a draft', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-draft-'));
	try {
		const { directory, manifest } = await snapshot(root, 'snapshot-failure', 'Original');
		const mutations = [];
		const github = args => {
			if (args[0] === 'api') {
				if (args[1].endsWith('/pages')) { return JSON.stringify({ public: false, build_type: 'workflow', html_url: 'https://private.example/book/' }); }
				if (args[1].includes('/commits/')) { return JSON.stringify({ sha: manifest.viewer.commit }); }
				if (args[1].includes('/matching-refs/')) { return '[]'; }
				return JSON.stringify({ private: true });
			}
			mutations.push(args[1]);
			if (args[1] === 'download') {
				const destination = args[args.indexOf('--dir') + 1];
				cpSync(path.join(directory, 'snapshot.json'), path.join(destination, 'snapshot.json'));
				cpSync(path.join(directory, 'snapshot.json'), path.join(destination, 'design-system.html'));
			}
			return '';
		};
		await assert.rejects(publishSnapshot(directory, { repository: 'team/book', github }), /checksum/);
		assert.deepEqual(mutations, ['create', 'download']);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('deployed versioned snapshots link the exact software release without replacing notes or duplicating links', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-release-link-'));
	try {
		const { directory, manifest } = await snapshot(root, 'snapshot-v1.2.3', '<h1>Released</h1>', {
			viewer: { version: '1.2.3', commit: 'a'.repeat(40), modified: false },
		});
		await writeFile(path.join(directory, 'index.html'), '<h1>Released</h1><!-- snapshot-version-navigation:start --><script>Hosted navigation</script><!-- snapshot-version-navigation:end -->');
		let body = 'Existing release notes.';
		let writes = 0;
		let sha = manifest.viewer.commit;
		const github = args => {
			if (args[0] === 'api') { return JSON.stringify({ sha }); }
			if (args[1] === 'view') { return JSON.stringify({ body, isDraft: false }); }
			assert.deepEqual(args.slice(0, 3), ['release', 'edit', 'v1.2.3']);
			body = args[args.indexOf('--notes') + 1];
			writes++;
			return '';
		};
		const input = { directory, repository: 'team/book', pagesUrl: 'https://team.github.io/book/', github };
		const linked = await linkSnapshotRelease(input);
		assert.match(body, /^Existing release notes\./);
		assert.match(body, /https:\/\/team\.github\.io\/book\/snapshots\/snapshot-v1\.2\.3\//);
		assert.equal((await linkSnapshotRelease(input)).changed, false);
		assert.deepEqual({ linked: linked.linked, tag: linked.tag, writes }, { linked: true, tag: 'v1.2.3', writes: 1 });
		sha = 'b'.repeat(40);
		await assert.rejects(linkSnapshotRelease(input), /exact software release revision/);
		sha = manifest.viewer.commit;
		await writeFile(path.join(directory, 'index.html'), 'Corrupted');
		await assert.rejects(linkSnapshotRelease(input), /strictly equal/);
		assert.equal(writes, 1);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('non-versioned snapshots do not change software releases', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'snapshot-unlinked-'));
	try {
		const { directory } = await snapshot(root, 'snapshot-review', 'Review', {
			viewer: { version: '1.2.3', commit: 'a'.repeat(40), modified: false },
		});
		const result = await linkSnapshotRelease({ directory, repository: 'team/book', pagesUrl: 'https://team.github.io/book/',
			github: () => { throw new Error('Must not contact GitHub'); } });
		assert.equal(result.linked, false);
	} finally { await rm(root, { recursive: true, force: true }); }
});
