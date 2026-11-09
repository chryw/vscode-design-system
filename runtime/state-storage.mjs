/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build canvas runtime. */
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bookId } from './book.mjs';
import { validateState } from './view-state.mjs';
import { readRepository } from '../adapters/vscode/repository.mjs';

export class StateStorageError extends Error {
	constructor(code, message, cause) { super(message, { cause }); this.code = code; }
}

export function copilotHome() {
	return process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

export class ViewStateStorage {
	constructor(checkout, { home = copilotHome(), book = bookId, view } = {}) {
		if (view !== undefined && (typeof view !== 'string' || !view || view.length > 512)) {
			throw new Error('Invalid saved book view identity');
		}
		this.identity = { checkout: realpathSync(checkout), book, ...(view === undefined ? {} : { view }) };
		this.repository = readRepository(checkout);
		this.directory = path.join(home, 'extension-data', bookId);
		const key = createHash('sha256').update(JSON.stringify(this.identity)).digest('hex');
		this.file = path.join(this.directory, `${key}.json`);
		this.lock = `${this.file}.lock`;
	}
	read() {
		try {
			let stat;
			try { stat = lstatSync(this.file); }
			catch (error) { if (error.code === 'ENOENT') { return undefined; } throw error; }
			if (!stat.isFile() || stat.size > 1024 * 1024) { throw new Error('Expected a bounded regular state file'); }
			const record = JSON.parse(readFileSync(this.file, 'utf8'));
			if (record.format !== 'vscode-design-system-view' || record.version !== 1
				|| !Number.isSafeInteger(record.revision) || record.revision < 1
				|| typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))
				|| record.identity?.checkout !== this.identity.checkout || record.identity?.book !== this.identity.book
				|| record.identity?.view !== this.identity.view) {
				throw new Error('Unsupported format, version, or book identity');
			}
			return { ...record, state: validateState(record.state, this.repository) };
		} catch (error) {
			throw new StateStorageError('STATE_READ_FAILED', `Couldn't restore saved design-system state at ${this.file}. Preserve or move that file before retrying: ${error.message}`, error);
		}
	}
	update(change) {
		let lock;
		let temporary;
		try {
			mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			if (!lstatSync(this.directory).isDirectory()) { throw new Error('Private state directory must not be a symlink'); }
			chmodSync(this.directory, 0o700);
			try { lock = openSync(this.lock, 'wx', 0o600); }
			catch (error) {
				if (error.code === 'EEXIST') {
					throw new StateStorageError('STATE_BUSY', 'Another provider is saving this book. Retry the action; if its provider stopped during a save, remove the stale state lock before reopening.', error);
				}
				throw error;
			}
			writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
			const previous = this.read();
			const state = validateState(change(previous?.state), this.repository);
			const record = {
				format: 'vscode-design-system-view', version: 1, identity: this.identity,
				revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), state,
			};
			const text = JSON.stringify(record);
			if (Buffer.byteLength(text) > 1024 * 1024) { throw new Error('Saved view state is too large'); }
			temporary = path.join(this.directory, `.${path.basename(this.file)}.${randomUUID()}.pending`);
			const descriptor = openSync(temporary, 'wx', 0o600);
			try { writeFileSync(descriptor, text); fsyncSync(descriptor); }
			finally { closeSync(descriptor); }
			renameSync(temporary, this.file);
			temporary = undefined;
			return state;
		} catch (error) {
			if (error instanceof StateStorageError) { throw error; }
			throw new StateStorageError('STATE_WRITE_FAILED', `Couldn't save design-system state at ${this.file}: ${error.message}`, error);
		} finally {
			if (temporary) { unlinkSync(temporary); }
			if (lock !== undefined) { closeSync(lock); unlinkSync(this.lock); }
		}
	}
}
