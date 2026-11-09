/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { readSizeTokens } from '../typography.mjs';
export function load({ read }) {
	const file = 'src/vs/platform/theme/common/sizes/baseSizes.ts';
	const text = read(file);
	const sizes = readSizeTokens(text, file);
	if (!sizes.length || sizes.length !== [...text.matchAll(/\bregisterSize\(/g)].length) {
		throw new Error('Some base size registrations were not recognized. Update the source adapter.');
	}
	return { sizes };
}
