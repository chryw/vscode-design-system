/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalRoot, contained } from '../runtime/store.mjs';
import { packageRoot } from '../runtime/paths.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';

const relativeTarget = '.github/extensions/vscode-design-system';
const marker = '.canvas-installation.json';
const entries = ['extension.mjs', 'package.json', 'LICENSE.txt', 'compatibility.json', 'runtime', 'model', 'adapters', 'view', 'scripts'];

function digest(root) {
	const hash = createHash('sha256');
	const visit = relative => {
		for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
			if (!relative && entry.name === marker) { continue; }
			const file = path.join(relative, entry.name);
			if (entry.isSymbolicLink()) { throw new Error(`Installation must not contain symlinks: ${file}`); }
			if (entry.isDirectory()) { visit(file); }
			else if (entry.isFile()) { hash.update(JSON.stringify(file.split(path.sep))).update(readFileSync(path.join(root, file))); }
			else { throw new Error(`Unsupported installation file: ${file}`); }
		}
	};
	visit('');
	return hash.digest('hex');
}

export function install(workspace, { update = false, source = packageRoot, rename = renameSync } = {}) {
	const root = canonicalRoot(workspace);
	readRepository(root);
	const target = contained(root, relativeTarget);
	if (target === path.resolve(source)) { throw new Error('Install from a separate clone, not the workspace extension itself'); }
	const tracked = execFileSync('git', ['ls-files', '--', relativeTarget], { cwd: root, encoding: 'utf8' });
	if (tracked.trim()) { throw new Error('The checkout already tracks a canvas extension; remove that registration before installing'); }
	mkdirSync(path.dirname(target), { recursive: true });
	const lock = `${target}.install-lock`;
	mkdirSync(lock);
	let staging;
	let backup;
	let preserveRecovery = false;
	try {
		if (existsSync(target)) {
			if (lstatSync(target).isSymbolicLink()) { throw new Error('Refusing to replace a symlink installation'); }
			if (!existsSync(path.join(target, marker))) { throw new Error('Refusing to replace an unmanaged extension'); }
			const previous = JSON.parse(readFileSync(path.join(target, marker), 'utf8'));
			if (previous.format !== 'vscode-design-system-installation' || previous.version !== 1 || previous.digest !== digest(target)) {
				throw new Error('Installed files have changed or installation metadata is invalid; preserve them before reinstalling');
			}
			if (!update) { throw new Error('Already installed. Use --update to replace this managed installation'); }
		}
		staging = mkdtempSync(`${target}.staging-`);
		for (const entry of entries) { cpSync(path.join(source, entry), path.join(staging, entry), { recursive: true, dereference: false }); }
		const version = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')).version;
		writeFileSync(path.join(staging, marker), JSON.stringify({
			format: 'vscode-design-system-installation', version: 1, viewerVersion: version, digest: digest(staging),
		}, null, '\t'));
		const ignored = spawnSync('git', ['check-ignore', '-q', '--', relativeTarget], { cwd: root });
		if (ignored.error) { throw ignored.error; }
		if (ignored.status === 1) {
			const exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8' }).trim();
			const excludeFile = path.resolve(root, exclude);
			mkdirSync(path.dirname(excludeFile), { recursive: true });
			appendFileSync(excludeFile, `\n# Private design-system canvas installation\n/${relativeTarget}/\n`);
		} else if (ignored.status !== 0) { throw new Error('Could not inspect local Git exclusion rules'); }
		if (existsSync(target)) { backup = path.join(lock, 'previous'); rename(target, backup); }
		try { rename(staging, target); staging = undefined; }
		catch (error) {
			if (backup) {
				try { rename(backup, target); backup = undefined; }
				catch (rollbackError) {
					preserveRecovery = true;
					throw new AggregateError([error, rollbackError], `Installation and rollback failed. The previous installation is preserved at ${backup}`);
				}
			}
			throw error;
		}
		return { installed: target, viewerVersion: version, root, canvasId: 'vscode-design-system', input: { root } };
	} finally {
		if (staging) { rmSync(staging, { recursive: true, force: true }); }
		if (!preserveRecovery) { rmSync(lock, { recursive: true, force: true }); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	if (args.length < 2 || args.length > 3 || args[0] !== '--workspace' || !args[1] || args.length === 3 && args[2] !== '--update') {
		throw new Error('Usage: node scripts/install.mjs --workspace <VS Code checkout> [--update]');
	}
	console.log(JSON.stringify(install(args[1], { update: args[2] === '--update' }), null, '\t'));
}
