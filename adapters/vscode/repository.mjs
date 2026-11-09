/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Checkout-owned metadata for the no-build canvas. */
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { contained, workspaceRoot } from '../../runtime/paths.mjs';
import { readBook } from '../../runtime/book.mjs';
import { createRepository } from '../../model/repository.mjs';

export const repositoryDirectory = '.github/design-system';
export function readRepository(root = workspaceRoot, { bookRoot = contained(root, repositoryDirectory) } = {}) {
	const read = file => {
		const target = contained(bookRoot, file);
		if (statSync(target).size > 1024 * 1024) { throw new Error(`Repository metadata is too large: ${file}`); }
		return JSON.parse(readFileSync(target, 'utf8'));
	};
	return createRepository({
		format: 'vscode-design-repository', version: 1, book: readBook(bookRoot),
		curation: read('content/components/curation.json'), bindings: read('content/components/fixture-bindings.json'),
		toolkit: read('content/components/toolkit-specifications.json'), tokens: read('content/foundations/token-domains.json'),
		expectations: read('content/foundations/reference-expectations.json'),
		references: { components: `${repositoryDirectory}/components.md`, foundations: `${repositoryDirectory}/foundations.md` },
	});
}
