/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { primitiveReference } from './controls.mjs';
import { foundationReference } from './token-lookup.mjs';
import { catalog } from './topics/catalog.mjs';

export function topicPresentation(system, view) {
	const foundationSections = (system.catalog ?? catalog).filter(topic => topic.group === 'Foundations').map(topic => topic.id);
	const references = system.repositoryReferences;
	const source = view.section === 'documentation' ? system.library.document?.source
		: view.section === 'components'
		? { file: (view.controlId && system.controls.find(control => control.id === view.controlId).owner) || references?.components || primitiveReference }
		: view.section === 'tokens' ? { file: references?.foundations || foundationReference }
		: view.section === 'motion' ? { file: 'src/vs/platform/theme/common/motion/MOTION.md' }
		: ['typography', 'spacing', 'shape', 'size', 'stroke'].includes(view.section)
			? system.sizes[0].source
			: view.section === 'colors'
				? { file: 'src/vs/platform/theme/common/colors/baseColors.ts' }
			: view.section === 'theming'
				? { file: system.theme.file }
				: view.section === 'iconography'
					? system.icons[0].source
					: view.section === 'elevation'
						? system.elevation.tiers.source
						: { file: system.documents[view.section][0].file };
	return {
		foundation: foundationSections.includes(view.section),
		search: view.section === 'tokens',
		theme: false,
		source,
	};
}

export function pageJumps(_view, page) {
	return page?.sections?.map(({ id, title }) => ({ anchor: id, label: title })) ?? [];
}
