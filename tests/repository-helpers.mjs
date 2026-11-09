/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Test-only repository inputs for pure presentation helpers. */
import { readRepository } from '../adapters/vscode/repository.mjs';
import { setRepository } from '../view/context.mjs';
import { createControls as create, curateFixtures as curate } from '../model/components.mjs';
export { readRepository };
export { validateBook } from '../model/catalog.mjs';
export const repository = readRepository();
export const { catalog, sections, bookTitle, controls, motionControls, spacingControl, componentAliases,
	toolkitFile, toolkitSpecifications, tokenDomains, corePaletteThemes, pageStructures, expectedCapabilities,
	primitiveReference, foundationReference, controlGaps, getTopic, topicId, visibleTopicIds, validateScope } = repository;
setRepository(repository.projection);
export const foundationSections = repository.catalog.filter(topic => topic.group === 'Foundations').map(topic => topic.id);
export const createControls = (input, specifications = repository.toolkitSpecifications) => create(input, specifications);
export const curateFixtures = (fixtures, inventory = repository.controls) => curate(fixtures, inventory);
