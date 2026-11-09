/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build repository projection contract. */
import { createCatalog } from './catalog.mjs';
import { createControls } from './components.mjs';

export function createRepository(input) {
	if (input?.format !== 'vscode-design-repository' || input.version !== 1
		|| !Array.isArray(input.toolkit?.specifications) || typeof input.toolkit.file !== 'string'
		|| !Array.isArray(input.bindings?.motion) || !input.bindings.spacing
		|| !Array.isArray(input.tokens?.domains) || !Array.isArray(input.tokens.palettes)
		|| !input.expectations?.structures || !input.expectations.capabilities
		|| typeof input.references?.components !== 'string' || typeof input.references.foundations !== 'string') {
		throw new Error('Invalid design-system repository projection');
	}
	const { controls, aliases } = createControls(input.curation, input.toolkit.specifications);
	return {
		...createCatalog(input.book, aliases), projection: input, controls, componentAliases: aliases,
		motionControls: input.bindings.motion, spacingControl: input.bindings.spacing,
		toolkitFile: input.toolkit.file, toolkitSpecifications: input.toolkit.specifications,
		tokenDomains: input.tokens.domains, corePaletteThemes: input.tokens.palettes,
		pageStructures: input.expectations.structures, expectedCapabilities: input.expectations.capabilities,
		primitiveReference: input.references.components, foundationReference: input.references.foundations,
		controlGaps: controls.filter(control => !control.hidden && control.content === 'tbd')
			.map(control => ({ name: control.name, note: input.curation.missingReference, owner: control.owner })),
	};
}
