/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Isolated document-contract test inputs. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot, workspaceRoot } from '../runtime/paths.mjs';

export const checkoutRoot = workspaceRoot;
export const canvasRoot = packageRoot;
export const repositoryRoot = path.join(checkoutRoot, '.github/skills/design-system');

export function createDocumentCheckout(t) {
	mkdirSync(path.join(checkoutRoot, '.build'), { recursive: true });
	const directory = mkdtempSync(path.join(checkoutRoot, '.build/design-documents-'));
	const bookRoot = path.join(directory, '.github/skills/design-system');
	cpSync(repositoryRoot, bookRoot, { recursive: true });
	// Current checkouts derive documentation scopes from the viewer; only older curated checkouts declare them.
	if (existsSync(path.join(bookRoot, 'content/components/curation.json'))) {
		writeFileSync(path.join(bookRoot, 'content/document-sources.json'), JSON.stringify([
			{ id: 'product', title: 'Product documentation', root: 'src/vs', origin: 'product' },
			{ id: 'instructions', title: 'Instructions', root: '.github/instructions', origin: 'instruction' },
			{ id: 'design-system-entry', title: 'Design-system skill', root: '.github/skills/design-system', origin: 'skill', fileName: 'SKILL.md' },
			{ id: 'design-system-references', title: 'Design-system authoring workflows', root: '.github/skills/design-system/references', origin: 'skill' },
			{ id: 'design-foundations', title: 'Design foundations', root: '.github/skills/design-system/foundations', origin: 'book' },
			{ id: 'design-patterns', title: 'Design patterns', root: '.github/skills/design-system/patterns', origin: 'book' },
		]));
	}
	const write = (file, text) => {
		const target = path.join(directory, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, text);
	};
	mkdirSync(path.join(directory, 'extensions'));
	write('src/vs/platform/theme/common/sizes/baseSizes.ts', '');
	write('.github/instructions/example.instructions.md', '---\napplyTo: "**/*.css"\ndescription: special-scope\n---\n# CSS guidance\n\nPreserve focus.\n');
	write('src/vs/feature/feature-notes.md', '# Feature notes\n\nA distinct product contract sentinel 7f31.\n\n## Behavior\n\nKeep user choices.\n');
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return { root: directory, bookRoot, write };
}
