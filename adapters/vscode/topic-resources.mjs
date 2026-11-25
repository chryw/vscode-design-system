/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Shared no-build topic-resource projection. */
import { definitionEntries } from '../../model/token-definitions.mjs';

function definitions(data) {
	const group = (definitionKind, entries) => entries.map(entry => ({ ...entry, definitionKind }));
	let groups;
	switch (data.view.section) {
		case 'motion':
			// Guidance-only Motion chapters have no runtime definitions to project.
			if (!data.motionDocumentation) { groups = []; break; }
			groups = [
				group('motion-token', data.motionDocumentation.tokens),
				group('motion-recipe', data.motionDocumentation.recipes),
				group('motion-analysis', data.motionDocumentation.analyses),
				group('motion-preset', data.motionDocumentation.presets.map(preset => ({ ...preset, presetId: preset.id, id: `motion.preset.${preset.id}` }))),
				group('motion-preset-binding', data.motionDocumentation.bindings.map(binding => ({
					id: `motion.presetBinding.${binding.id}`, bindingId: binding.id, presetId: binding.preset, source: binding.source,
					phases: binding.phases.map(phase => ({
						phase: phase.phase, response: phase.response, durationTokens: phase.durationTokens, easingTokens: phase.easingTokens,
					})),
				}))),
				group('motion-response', data.motionDocumentation.responses.map(response => ({
					id: `motion.response.${response.id}`, responseId: response.id, label: response.label, source: response.source,
					frequencyHz: response.frequencyHz, dampingRatio: response.dampingRatio, durationMs: response.durationMs, limits: response.limits,
					metrics: {
						response50Ms: response.metrics.response50Ms, settle2PercentMs: response.metrics.settle2PercentMs,
						endpointResidual: response.metrics.endpointResidual, maxInterpolationError: response.metrics.maxInterpolationError,
					},
				}))),
			];
			break;
		case 'components':
			groups = [group('component-api', data.controls.flatMap(control =>
				(control.docs.api ?? []).map(member => ({ ...member, componentId: control.id }))))];
			break;
		case 'typography':
			groups = [group('type-token', data.typography.tokens), group('font-family', data.typography.families)];
			break;
		case 'tokens': groups = [group('design-token', definitionEntries(data))]; break;
		case 'colors': groups = [group('color', data.colors)]; break;
		case 'theming': groups = [group('theme', data.themes), group('color', data.colors)]; break;
		case 'iconography': groups = [group('icon', data.icons)]; break;
		case 'elevation': groups = [group('shadow', data.elevation.cssShadows)]; break;
		default: groups = [group('token', data.sizes)];
	}
	const entries = [];
	for (let index = 0; groups.some(group => index < group.length); index++) {
		for (const group of groups) {
			if (index < group.length) { entries.push(group[index]); }
		}
	}
	return entries;
}

export function createTopicResources(data) {
	const primary = data.controls[0]?.docs.design?.id ?? data.motionDocumentation?.page.source ?? data.page?.source ?? data.page?.sources?.[0]?.file;
	const composed = (data.sourceSections ?? []).map(section => ({
		file: section.source.file, text: section.markdown, source: section.source, anchor: section.anchor, title: section.title,
	}));
	const composedFiles = new Set(composed.map(section => section.file));
	const documents = (data.sourceDocuments ?? []).map(document => ({ file: document.id, title: document.title, source: document.source }))
		.sort((a, b) => Number(b.file === primary) - Number(a.file === primary)
			|| Number(b.file.endsWith('.design.md')) - Number(a.file.endsWith('.design.md')));
	const guidance = [
		...documents.filter(document => document.file === primary),
		...composed.filter(section => section.file !== primary),
		...documents.filter(document => document.file !== primary && !composedFiles.has(document.file)),
	];
	const known = new Set(guidance.map(document => document.file));
	guidance.push(...(data.documents[data.view.section] ?? []).filter(document => !known.has(document.file)));
	const examples = data.controls.filter(control => control.groups.length).map(control => ({
		kind: 'component-fixture', componentId: control.id, groups: control.groups, source: { file: control.file, line: 1 },
	}));
	for (const example of data.motionDocumentation?.page.examples ?? []) {
		const binding = data.motionDocumentation.bindings.find(binding => binding.id === example.presetBindingId);
		if (example.presetBindingId && !binding) { throw new Error(`Missing Motion example binding: ${example.presetBindingId}`); }
		examples.push({ kind: 'motion-example', id: example.id, presetBindingId: example.presetBindingId,
			source: { file: data.motionDocumentation.pageFile, line: 1 }, ...(binding ? { bindingSource: binding.source } : {}) });
	}
	return { version: 1, guidance, definitions: definitions(data), examples };
}
