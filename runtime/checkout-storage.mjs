/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { copilotHome, StateStorageError } from './state-storage.mjs';

export class CheckoutStorage {
	constructor(workspace, view, { home = copilotHome() } = {}) {
		this.identity = { workspace: realpathSync(workspace), view };
		this.directory = path.join(home, 'extension-data', 'vscode-design-system');
		const key = createHash('sha256').update(JSON.stringify(this.identity)).digest('hex');
		this.file = path.join(this.directory, `${key}.checkout.json`);
	}
	read() {
		try {
			let stat;
			try { stat = lstatSync(this.file); }
			catch (error) { if (error.code === 'ENOENT') { return undefined; } throw error; }
			if (!stat.isFile() || stat.size > 16384) { throw new Error('Expected a bounded regular checkout-selection file'); }
			const record = JSON.parse(readFileSync(this.file, 'utf8'));
			if (record.format !== 'vscode-design-checkout' || record.version !== 1
				|| record.identity?.workspace !== this.identity.workspace || record.identity?.view !== this.identity.view
				|| typeof record.root !== 'string' || record.root.length > 4096 || !path.isAbsolute(record.root)) {
				throw new Error('Invalid saved checkout selection');
			}
			return record.root;
		} catch (error) {
			throw new StateStorageError('CHECKOUT_READ_FAILED', `Couldn't restore checkout selection at ${this.file}: ${error.message}`, error);
		}
	}
	write(root) {
		if (typeof root !== 'string' || root.length > 4096 || !path.isAbsolute(root)) { throw new Error('Expected an absolute checkout path'); }
		let lock;
		let temporary;
		try {
			mkdirSync(this.directory, { recursive: true, mode: 0o700 });
			if (!lstatSync(this.directory).isDirectory()) { throw new Error('Private state directory must not be a symlink'); }
			lock = openSync(`${this.file}.lock`, 'wx', 0o600);
			this.read();
			temporary = path.join(this.directory, `.${path.basename(this.file)}.${randomUUID()}.pending`);
			const descriptor = openSync(temporary, 'wx', 0o600);
			try {
				writeFileSync(descriptor, JSON.stringify({
					format: 'vscode-design-checkout', version: 1, identity: this.identity, root,
				}));
				fsyncSync(descriptor);
			} finally { closeSync(descriptor); }
			renameSync(temporary, this.file);
			temporary = undefined;
		} catch (error) {
			throw new StateStorageError('CHECKOUT_WRITE_FAILED', `Couldn't save checkout selection at ${this.file}: ${error.message}`, error);
		} finally {
			if (temporary) { unlinkSync(temporary); }
			if (lock !== undefined) { closeSync(lock); unlinkSync(`${this.file}.lock`); }
		}
	}
}
