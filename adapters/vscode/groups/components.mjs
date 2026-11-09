/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createControls } from '../../../model/components.mjs';
import { documentControl } from '../component-docs.mjs';
import { readContent } from './authored.mjs';
export function load({ read }, controlId) {
	read('.github/design-system/components.md');
	const curation = readContent(read, 'content/components/curation.json');
	const specifications = readContent(read, 'content/components/toolkit-specifications.json');
	const { controls } = createControls(curation, specifications.specifications);
	const control = controls.find(item => item.id === controlId);
	if (!control) { throw new Error('Unknown component'); }
	if (control.file) { read(control.file); }
	const documentation = control.content === 'ready' ? readContent(read, `content/components/references/${control.id}.json`) : undefined;
	const controlGaps = controls.filter(control => !control.hidden && control.content === 'tbd')
		.map(control => ({ name: control.name, note: curation.missingReference, owner: control.owner }));
	return { controls: [documentControl(control, read, documentation)], controlGaps };
}
