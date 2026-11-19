/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Checkout-owned metadata for the no-build canvas. */
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { contained, workspaceRoot } from '../../runtime/paths.mjs';
import { readBookSource } from '../../runtime/book.mjs';
import { createRepository } from '../../model/repository.mjs';
import { basicProjection } from './basic-book.mjs';

export const repositoryDirectory = '.github/design-system';
export function readRepository(root = workspaceRoot, { bookRoot = contained(root, repositoryDirectory) } = {}) {
	const read = file => {
		const target = contained(bookRoot, file);
		if (statSync(target).size > 1024 * 1024) { throw new Error(`Repository metadata is too large: ${file}`); }
		return readFileSync(target, 'utf8');
	};
	const source = readBookSource(read);
	if (!source) {
		return createRepository(basicProjection());
	}
	const { book } = source;
	const json = file => JSON.parse(read(file));
	return createRepository({
		format: 'vscode-design-repository', version: 1, mode: 'curated',
		capabilities: { curatedTopics: true, liveExamples: true, documents: true }, book,
		curation: json('content/components/curation.json'), bindings: json('content/components/fixture-bindings.json'),
		toolkit: json('content/components/toolkit-specifications.json'), tokens: json('content/foundations/token-domains.json'),
		expectations: json('content/foundations/reference-expectations.json'),
		references: { components: `${repositoryDirectory}/components.md`, foundations: `${repositoryDirectory}/foundations.md` },
	});
}
