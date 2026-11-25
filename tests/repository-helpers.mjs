/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Test-only repository inputs for pure presentation helpers. */
import { readFileSync } from 'node:fs';
import { readRepository } from '../adapters/vscode/repository.mjs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { setRepository } from '../view/context.mjs';
import { createControls as create, curateFixtures as curate } from '../model/components.mjs';
export { readRepository };
export { validateBook } from '../model/catalog.mjs';
export const repository = readRepository();
export const { catalog, sections, bookTitle, controls, motionControls, spacingControl, componentAliases,
	toolkitFile, toolkitSpecifications, tokenDomains, corePaletteThemes,
	primitiveReference, foundationReference, controlGaps, getTopic, topicId, visibleTopicIds, validateScope } = repository;
setRepository(repository.projection);
export const foundationSections = repository.catalog.filter(topic => topic.group === 'Foundations').map(topic => topic.id);
export const createControls = (input, specifications = repository.toolkitSpecifications) => create(input, specifications);
export const curateFixtures = (fixtures, inventory = repository.controls) => curate(fixtures, inventory);

/** Legacy checkouts supplied coverage wording and these covered documents; authored checkouts carry readiness in front matter. */
export function legacySystem(data, notes = new Proxy({}, { get: (_, id) => new Proxy({}, { get: (_, expected) => new Proxy({}, { get: (_, variant) => `${id}: ${expected} (${variant})` }) }) })) {
	const files = ['.github/skills/design-system/foundations/principles.design.md', '.github/instructions/design-tokens.instructions.md',
		'.github/skills/ux-css-layout/SKILL.md', '.github/skills/ux-theming/SKILL.md'];
	return {
		...data, referenceNotes: notes, sourceFiles: [...data.sourceFiles, ...files],
		documents: { ...data.documents, legacy: files.map(file => ({ file, text: readFileSync(`${workspaceRoot}/${file}`, 'utf8') })) },
	};
}
