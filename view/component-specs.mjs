/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { toolkitFile } from './context.mjs';
export { toolkitFile, toolkitSpecifications } from './context.mjs';

export function specificationUrl(nodeId) {
	return `https://www.figma.com/design/${toolkitFile}/?node-id=${nodeId.replace(':', '-')}`;
}
