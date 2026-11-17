/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readSnapshot, validateSnapshotTag } from './release-snapshot.mjs';

export async function buildSnapshotPages({ repository, output, github = args => execFileSync('gh', args, {
	encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
}) }) {
	assert.match(repository ?? '', /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, 'Select --repository <owner/repo>');
	assert.ok(output, 'Select --output <new directory>');
	const releases = JSON.parse(github(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])).flat()
		.filter(release => !release.draft && release.tag_name.startsWith('snapshot-'))
		.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.tag_name.localeCompare(b.tag_name));
	assert.ok(releases.length, 'There are no published snapshot releases to deploy');
	const scratch = await mkdtemp(path.join(os.tmpdir(), 'snapshot-pages-'));
	try {
		const site = path.join(scratch, 'site');
		await mkdir(path.join(site, 'snapshots'), { recursive: true });
		for (const release of releases) {
			const tag = validateSnapshotTag(release.tag_name);
			assert.ok(Number.isFinite(Date.parse(release.published_at)), `${tag}: missing publication timestamp`);
			for (const name of ['design-system.html', 'snapshot.json']) {
				assert.equal(release.assets.filter(asset => asset.name === name).length, 1, `${tag}: missing ${name}; refusing incomplete deployment`);
			}
			const destination = path.join(site, 'snapshots', tag);
			await mkdir(destination);
			github(['release', 'download', tag, '--repo', repository, '--dir', destination, '--pattern', 'design-system.html', '--pattern', 'snapshot.json']);
			const { manifest, html } = await readSnapshot(destination, tag);
			await writeFile(path.join(destination, 'index.html'), html);
			await rm(path.join(destination, 'design-system.html'));
			if (release === releases[0]) {
				await writeFile(path.join(site, 'index.html'), html);
				await writeFile(path.join(site, 'snapshot.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
			}
		}
		await writeFile(path.join(site, '.nojekyll'), '');
		await mkdir(output);
		for (const name of await readdir(site)) {
			await cp(path.join(site, name), path.join(output, name), { recursive: true, errorOnExist: true, force: false });
		}
		console.log(JSON.stringify({ snapshots: releases.map(release => release.tag_name), latest: releases[0].tag_name, output }));
	} finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({ options: { repository: { type: 'string' }, output: { type: 'string' } } });
	await buildSnapshotPages(values);
}
