/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Checkout-owned metadata for the no-build canvas. */
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { contained, workspaceRoot } from '../../runtime/paths.mjs';
import { legacyRepositoryDirectory, readBookSource, readGeneratedBook, repositoryDirectory, repositoryDirectoryFor } from '../../runtime/book.mjs';
import { createRepository } from '../../model/repository.mjs';
import { basicBook, basicProjection } from './basic-book.mjs';

export { repositoryDirectory, repositoryDirectoryFor };

export function readRepository(root = workspaceRoot, options = {}) {
	const bookRoot = options.bookRoot ?? repositoryDirectoryFor(root);
	const read = file => {
		const target = contained(bookRoot, file);
		if (statSync(target).size > 1024 * 1024) { throw new Error(`Repository metadata is too large: ${file}`); }
		return readFileSync(target, 'utf8');
	};
	const relativeBookRoot = path.relative(root, bookRoot).split(path.sep).join('/');
	const generated = relativeBookRoot === repositoryDirectory ? readGeneratedBook(root) : undefined;
	const source = generated ? undefined : readBookSource(read);
	if (!source && !generated) {
		return createRepository(basicProjection(basicBook(relativeBookRoot || legacyRepositoryDirectory)));
	}
	const json = file => JSON.parse(read(file));
	const prefix = relativeBookRoot || legacyRepositoryDirectory;
	return createRepository({
		format: 'vscode-design-repository', version: 1, mode: 'curated',
		capabilities: { curatedTopics: true, liveExamples: true, documents: true },
		book: generated?.book ?? source.book, designSpecs: generated?.specs ?? [],
		curation: json('content/components/curation.json'), bindings: json('content/components/fixture-bindings.json'),
		toolkit: json('content/components/toolkit-specifications.json'), tokens: json('content/foundations/token-domains.json'),
		expectations: json('content/foundations/reference-expectations.json'),
		references: {
			components: `${prefix}/${generated ? 'references/component-overview.md' : 'components.md'}`,
			foundations: `${prefix}/${generated ? 'references/authoring-conventions.md' : 'foundations.md'}`,
		},
	});
}
