/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createControls } from '../../../model/components.mjs';
import { documentControl } from '../component-docs.mjs';
import { readContent } from './authored.mjs';
export function load(context, controlId) {
	const { read, root, repository } = context;
	const authored = repository.projection.mode === 'authored';
	if (!authored) { read(repository.projection.references.components); }
	const curation = authored ? undefined : readContent(read, 'content/components/curation.json');
	const specifications = authored ? undefined : readContent(read, 'content/components/toolkit-specifications.json');
	const { controls } = authored ? repository : createControls(curation, specifications.specifications, repository.projection.designSpecs);
	const control = controls.find(item => item.id === controlId);
	if (!control) { throw new Error('Unknown component'); }
	if (control.file) { read(control.file); }
	const documentation = control.content === 'ready' && !control.design ? readContent(read, `content/components/references/${control.id}.json`) : undefined;
	const controlGaps = controls.filter(control => !control.hidden && control.content === 'tbd')
		.map(control => ({ name: control.name, note: curation?.missingReference, owner: control.owner }));
	return { controls: [documentControl(control, read, documentation, root)], controlGaps };
}
