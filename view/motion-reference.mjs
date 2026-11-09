/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

/** Classify named purposes independently of whether their saved default is a literal or an alias. */
export function motionTokenCategory(token) {
	if (!token.id.startsWith(`motion.${token.kind}.`)) { return 'purpose'; }
	if (token.kind !== 'duration') { return 'parameter'; }
	return 'ramp';
}

export function motionTokenGroups(tokens) {
	const order = ['Duration scale', 'Easing', 'Feedback', 'Presence', 'Activity', 'Completion', 'Existing component signals'];
	const groups = Map.groupBy(tokens, token => {
		if (/^motion\.attention\./.test(token.id)) { return 'Existing component signals'; }
		if (/^motion\.(control|selection|press|border)\./.test(token.id)) { return 'Feedback'; }
		if (/^motion\.(surface|fade|content|toast|disclosure|scrollbar)\./.test(token.id)) { return 'Presence'; }
		if (/^motion\.(progress|spinner|matrix|logo|voice)\./.test(token.id)) { return 'Activity'; }
		if (/^motion\.confetti\./.test(token.id)) { return 'Completion'; }
		if (token.kind === 'duration') { return 'Duration scale'; }
		if (token.kind === 'easing') { return 'Easing'; }
		return 'Existing component signals';
	});
	return new Map(order.filter(name => groups.has(name)).map(name => [name, groups.get(name)]));
}
