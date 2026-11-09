/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Isolated document-contract test inputs. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot, workspaceRoot } from '../runtime/paths.mjs';

export const checkoutRoot = workspaceRoot;
export const canvasRoot = packageRoot;
export const repositoryRoot = path.join(checkoutRoot, '.github/design-system');

export function createDocumentCheckout(t) {
	mkdirSync(path.join(checkoutRoot, '.build'), { recursive: true });
	const directory = mkdtempSync(path.join(checkoutRoot, '.build/design-documents-'));
	const bookRoot = path.join(directory, '.github/design-system');
	cpSync(repositoryRoot, bookRoot, { recursive: true });
	const book = JSON.parse(readFileSync(path.join(repositoryRoot, 'book.json'), 'utf8'));
	book.documentSources = [
		{ id: 'product', title: 'Product documentation', root: 'src/vs', origin: 'product' },
		{ id: 'instructions', title: 'Instructions', root: '.github/instructions', origin: 'instruction' },
	];
	writeFileSync(path.join(bookRoot, 'book.json'), JSON.stringify(book));
	const write = (file, text) => {
		const target = path.join(directory, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, text);
	};
	write('src/vs/platform/theme/common/sizes/baseSizes.ts', '');
	write('.github/instructions/example.instructions.md', '---\napplyTo: "**/*.css"\ndescription: special-scope\n---\n# CSS guidance\n\nPreserve focus.\n');
	write('src/vs/feature/feature-notes.md', '# Feature notes\n\nA distinct product contract.\n\n## Behavior\n\nKeep user choices.\n');
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return { root: directory, bookRoot, write };
}
