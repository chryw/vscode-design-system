/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { readSnapshot, validateSnapshotTag } from './release-snapshot.mjs';

const navigationStart = '<!-- snapshot-version-navigation:start -->';
const navigationEnd = '<!-- snapshot-version-navigation:end -->';

export function snapshotSourceHTML(html) {
	const start = html.indexOf(navigationStart);
	const end = html.indexOf(navigationEnd);
	if (start === -1 && end === -1) { return html; }
	assert.ok(start >= 0 && end > start && html.indexOf(navigationStart, start + navigationStart.length) === -1
		&& html.indexOf(navigationEnd, end + navigationEnd.length) === -1, 'Invalid hosted snapshot navigation markers');
	return html.slice(0, start) + html.slice(end + navigationEnd.length);
}

function snapshotTopics(html, manifest) {
	const marker = '<script id="snapshot-payload" type="application/json">';
	const start = html.indexOf(marker);
	assert.ok(start >= 0, `${manifest.tag}: missing snapshot payload`);
	const end = html.indexOf('</script>', start + marker.length);
	assert.ok(end > start, `${manifest.tag}: incomplete snapshot payload`);
	const payload = JSON.parse(html.slice(start + marker.length, end));
	const snapshot = JSON.parse(gunzipSync(Buffer.from(payload.snapshot, 'base64')).toString('utf8'));
	const topics = snapshot.catalog.map(topic => topic.id);
	assert.ok(topics.length === manifest.renderedTopics && topics.length > 0 && new Set(topics).size === topics.length
		&& topics.every(topic => typeof topic === 'string' && /^[a-z][a-z0-9-]*$/.test(topic)), `${manifest.tag}: invalid snapshot topics`);
	return topics;
}

function hostedSnapshot(html, current, versions, base) {
	assert.equal(snapshotSourceHTML(html), html, 'Release assets must not contain hosted navigation');
	const data = JSON.stringify({ current, latest: versions[0].tag, versions }).replaceAll('<', '\\u003c');
	const navigation = `${navigationStart}<script id="snapshot-release-index" type="application/json" data-base="${base}">${data}</script><script type="module" src="${base}snapshot-versions.mjs"></script>${navigationEnd}`;
	const end = html.lastIndexOf('</body>');
	return end < 0 ? html + navigation : html.slice(0, end) + navigation + html.slice(end);
}

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
		const snapshots = [];
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
			snapshots.push({ tag, manifest, html: html.toString('utf8'), topics: snapshotTopics(html.toString('utf8'), manifest) });
			await rm(path.join(destination, 'design-system.html'));
		}
		const versions = snapshots.map(({ tag, topics }) => ({
			tag, label: /^snapshot-v\d+\.\d+\.\d+$/.test(tag) ? tag.slice('snapshot-'.length) : tag, topics,
		}));
		for (const snapshot of snapshots) {
			await writeFile(path.join(site, 'snapshots', snapshot.tag, 'index.html'), hostedSnapshot(snapshot.html, snapshot.tag, versions, '../../'));
		}
		await writeFile(path.join(site, 'index.html'), hostedSnapshot(snapshots[0].html, snapshots[0].tag, versions, './'));
		await writeFile(path.join(site, 'snapshot.json'), `${JSON.stringify(snapshots[0].manifest, null, '\t')}\n`);
		await writeFile(path.join(site, 'snapshot-versions.mjs'), await readFile(new URL('../view/snapshot-versions.mjs', import.meta.url)));
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
