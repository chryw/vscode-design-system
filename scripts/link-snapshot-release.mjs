/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256 } from './release-snapshot.mjs';
import { snapshotSourceHTML } from './build-snapshot-pages.mjs';

const start = '<!-- design-system-snapshot:start -->';
const end = '<!-- design-system-snapshot:end -->';

export async function linkSnapshotRelease({ directory, repository, pagesUrl, github = args => execFileSync('gh', args, { encoding: 'utf8' }).trim() }) {
	assert.match(repository ?? '', /^[\w-]+\/[\w.-]+$/);
	const manifest = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'));
	assert.equal(manifest.format, 'vscode-design-system-snapshot');
	assert.equal(manifest.version, 1);
	assert.match(manifest.viewer.version, /^\d+\.\d+\.\d+$/);
	assert.equal(manifest.viewer.modified, false);
	const tag = `v${manifest.viewer.version}`;
	if (manifest.tag !== `snapshot-${tag}`) { return { linked: false, reason: 'Snapshot is not a versioned software-release companion' }; }
	assert.equal(sha256(snapshotSourceHTML(await readFile(path.join(directory, 'index.html'), 'utf8'))), manifest.sha256);
	const base = new URL(pagesUrl);
	assert.equal(base.protocol, 'https:');
	assert.ok(!base.username && !base.password && !base.search && !base.hash);
	if (!base.pathname.endsWith('/')) { base.pathname += '/'; }
	const snapshotUrl = new URL(`snapshots/${manifest.tag}/`, base).href;
	const commit = JSON.parse(github(['api', `repos/${repository}/commits/${tag}`]));
	assert.equal(commit.sha, manifest.viewer.commit, 'Snapshot must use the exact software release revision');
	const release = JSON.parse(github(['release', 'view', tag, '--repo', repository, '--json', 'body,isDraft']));
	assert.equal(release.isDraft, false);
	const body = release.body ?? '';
	const first = body.indexOf(start);
	const last = body.indexOf(end);
	assert.ok(first === -1 && last === -1 || first >= 0 && last > first
		&& body.indexOf(start, first + start.length) === -1 && body.indexOf(end, last + end.length) === -1, 'Invalid snapshot section markers');
	const section = `${start}\n## Browser snapshot\n\n[Browse the ${tag} snapshot](${snapshotUrl}) — no VS Code or checkout needed.\n\n[Download the offline HTML](https://github.com/${repository}/releases/tag/${manifest.tag}).\n${end}`;
	const notes = first < 0 ? `${body.trimEnd()}\n\n${section}\n` : `${body.slice(0, first)}${section}${body.slice(last + end.length)}`;
	if (notes !== body) { github(['release', 'edit', tag, '--repo', repository, '--notes', notes]); }
	return { linked: true, changed: notes !== body, tag, snapshotUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({ options: {
		directory: { type: 'string' }, repository: { type: 'string' }, 'pages-url': { type: 'string' },
	} });
	assert.ok(values.directory && values.repository && values['pages-url'], 'Select --directory, --repository and --pages-url');
	console.log(JSON.stringify(await linkSnapshotRelease({ directory: values.directory, repository: values.repository, pagesUrl: values['pages-url'] })));
}
