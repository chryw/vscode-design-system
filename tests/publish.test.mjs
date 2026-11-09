/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Tests for the no-build canvas runtime. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const publisher = fileURLToPath(new URL('../scripts/publish.mjs', import.meta.url));

test('private Pages preflight rejects public, personal and legacy sites without publishing', async () => {
	const scratch = await mkdtemp(path.join(os.tmpdir(), 'design-book-preflight-'));
	try {
		const cli = path.join(scratch, 'gh');
		await writeFile(cli, `#!${process.execPath}
const endpoint = process.argv[3];
const mode = process.env.PREFLIGHT_CASE;
if (process.argv[2] !== 'api') { throw new Error('Preflight must not mutate GitHub'); }
if (endpoint === 'user') { console.log(JSON.stringify({ login: 'reviewer' })); }
else if (endpoint === 'repos/team/book') {
 console.log(JSON.stringify({ private: mode !== 'public-repo', owner: { type: mode === 'personal' ? 'User' : 'Organization' }, html_url: 'https://microsoft.ghe.com/team/book' }));
} else if (endpoint === 'repos/team/book/pages') {
 console.log(JSON.stringify({ public: mode === 'public-site' ? true : mode === 'unknown-site' ? undefined : false, build_type: mode === 'legacy' ? 'legacy' : 'workflow', html_url: 'https://private.pages.github.io/' }));
} else { throw new Error('Unexpected endpoint: ' + endpoint); }
`);
		await chmod(cli, 0o755);
		const check = (mode, extra = []) => execFileSync(process.execPath, [
			publisher, '--repository', 'microsoft.ghe.com/team/book', '--check',
			...extra,
		], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, PATH: `${scratch}${path.delimiter}${process.env.PATH}`, PREFLIGHT_CASE: mode } });
		assert.deepEqual(JSON.parse(check('private')), {
			account: 'reviewer', repository: 'https://microsoft.ghe.com/team/book', site: 'https://private.pages.github.io/', private: true,
		});
		assert.throws(() => check('public-repo'), /review repository must be private/);
		assert.throws(() => check('personal'), /must be private and organization-owned/);
		for (const mode of ['public-site', 'unknown-site', 'legacy']) {
			assert.throws(() => check(mode), /Refusing public or legacy Pages/);
		}
		assert.deepEqual(JSON.parse(check('personal', ['--repository-only'])), {
			account: 'reviewer', repository: 'https://microsoft.ghe.com/team/book',
			site: 'https://microsoft.ghe.com/team/book/releases/latest', private: true,
		});
		assert.throws(() => check('public-repo', ['--repository-only']), /review repository must be private/);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});
