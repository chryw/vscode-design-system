/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Checkout-owned metadata for the no-build canvas. */
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { contained, workspaceRoot } from '../../runtime/paths.mjs';
import { legacyRepositoryDirectory, readBookSource, readGeneratedBook, repositoryDirectory, repositoryDirectoryFor } from '../../runtime/book.mjs';
import { createRepository } from '../../model/repository.mjs';
import { basicBook, basicProjection } from './basic-book.mjs';
import { readDefaultPalettes, themeDefaultsFile } from './theme-palettes.mjs';
import { parseDocument } from '../../model/documents.mjs';

export { repositoryDirectory, repositoryDirectoryFor };

/** Live Motion examples are declared beside their guidance in the Motion specification's `specimens.examples`. */
function motionControls(specs) {
	const examples = specs.find(spec => spec.id === 'motion' && spec.presentation === 'motion')?.specimens?.examples ?? [];
	return examples.filter(example => example?.fixture !== undefined).map(example => {
		if (typeof example.id !== 'string' || typeof example.fixture !== 'string' || !/^[\w-]+(?:\/[\w-]+)+$/.test(example.fixture)
			|| typeof example.file !== 'string' || !/^src\/[\w/.-]+\.fixture\.ts$/.test(example.file) || example.file.split('/').includes('..')
			|| example.label !== undefined && typeof example.label !== 'string') {
			throw new Error(`Invalid Motion example fixture binding: ${example?.id}`);
		}
		const name = example.label ?? example.fixture.split('/').at(-1);
		return { id: `motion-${example.id}`, name, groups: [example.fixture], groupLabels: { [example.fixture]: name }, file: example.file };
	});
}

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
	const authored = generated?.mode === 'authored';
	const domains = authored ? generated.specs.filter(spec => spec.tokenDomain)
		.map(spec => ({ id: spec.id, title: spec.title, file: spec.path })) : [];
	const tokenGuide = '.github/instructions/design-tokens.instructions.md';
	if (authored && existsSync(path.join(root, tokenGuide))) {
		const document = parseDocument(readFileSync(contained(root, tokenGuide), 'utf8'), { id: tokenGuide });
		const deprecated = document.headings.find(heading => heading.id === 'deprecated-aliases');
		if (deprecated) { domains.push({ id: 'legacy', title: deprecated.title, file: tokenGuide, anchor: deprecated.id }); }
	}
	return createRepository({
		format: 'vscode-design-repository', version: 1, mode: authored ? 'authored' : 'curated',
		capabilities: { curatedTopics: true, liveExamples: true, documents: true },
		book: generated?.book ?? source.book, designSpecs: generated?.specs ?? [],
		curation: authored ? { version: 1, productControls: [], families: [], additions: [] } : json('content/components/curation.json'),
		bindings: authored ? { motion: motionControls(generated.specs), spacing: {} } : json('content/components/fixture-bindings.json'),
		toolkit: authored ? { file: '', specifications: [] } : json('content/components/toolkit-specifications.json'),
		tokens: authored ? {
			domains,
			palettes: existsSync(path.join(root, themeDefaultsFile))
				? readDefaultPalettes(readFileSync(contained(root, themeDefaultsFile), 'utf8')) : [],
		} : json('content/foundations/token-domains.json'),
		references: {
			...(authored ? {} : { components: `${prefix}/${generated ? 'references/component-overview.md' : 'components.md'}` }),
			foundations: `${prefix}/${generated ? 'references/authoring-conventions.md' : 'foundations.md'}`,
		},
	});
}
