/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Browser-local projection of the selected repository. */
import { createRepository } from '../model/repository.mjs';

export let catalog, sections, bookTitle, controls, motionControls, spacingControl, componentAliases;
export let toolkitFile, toolkitSpecifications, tokenDomains, corePaletteThemes, pageStructures, expectedCapabilities;
export let primitiveReference, foundationReference, controlGaps;
let repository;

export function setRepository(projection) {
	repository = createRepository(projection);
	({ catalog, sections, bookTitle, controls, motionControls, spacingControl, componentAliases,
		toolkitFile, toolkitSpecifications, tokenDomains, corePaletteThemes, pageStructures, expectedCapabilities,
		primitiveReference, foundationReference, controlGaps } = repository);
}

function current() {
	if (!repository) { throw new Error('Load the repository projection before rendering the book'); }
	return repository;
}
export const getTopic = id => current().getTopic(id);
export const topicId = view => current().topicId(view);
export const visibleTopicIds = scope => current().visibleTopicIds(scope);
export const validateScope = (input, scope) => current().validateScope(input, scope);
