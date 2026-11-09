/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Source adapters execute directly in Node. */

import { readMotionData } from './motion-source.mjs';

export const motionPresetBindingFiles = [
	'src/vs/platform/theme/common/motion/motionPresets.ts',
	'src/vs/platform/theme/common/motion/motionPresetBindings.ts',
];

function sourceOffset(text, id) {
	const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return text.search(new RegExp(`\\bid:\\s*['"]${escaped}['"]`));
}

export function readMotionPresetBindings(context, definitions) {
	if (definitions.status === 'absent') { return { status: 'absent', presets: [], bindings: [] }; }
	const texts = motionPresetBindingFiles.map(file => {
		try { return context.read(file); }
		catch (error) { if (error.code === 'ENOENT') { return null; } throw error; }
	});
	if (texts.every(text => text === null)) { return { status: 'absent', presets: [], bindings: [] }; }
	if (texts.some(text => text === null)) { throw new Error('Motion preset definitions and bindings are incomplete.'); }
	const dataContext = { ...context, read: file => texts[motionPresetBindingFiles.indexOf(file)] };
	const { motionPresets: presets } = readMotionData(dataContext, motionPresetBindingFiles[0], ['motionPresets']);
	const { motionPresetBindings: bindings } = readMotionData(dataContext, motionPresetBindingFiles[1], ['motionPresetBindings']);
	if (!Array.isArray(presets) || !presets.length || !Array.isArray(bindings) || !bindings.length) {
		throw new Error('Motion preset definitions and bindings must not be empty.');
	}
	const presetsById = new Map(presets.map(preset => [preset.id, preset]));
	const responsesById = new Map(definitions.responses.map(response => [response.id, response]));
	if (presetsById.size !== presets.length || new Set(bindings.map(binding => binding.id)).size !== bindings.length
		|| bindings.length !== presets.length) {
		throw new Error('Duplicate or missing Motion preset and binding identities.');
	}
	for (const preset of presets) {
		if (!preset.id || !preset.label || !preset.purpose || !preset.applicability || !preset.intent
			|| preset.reducedMotion !== 'immediate' || !preset.requirements || !Array.isArray(preset.phases) || !preset.phases.length
			|| new Set(preset.phases.map(phase => phase.phase)).size !== preset.phases.length) {
			throw new Error(`Invalid Motion preset: ${preset.id}`);
		}
		for (const phase of preset.phases) {
			const response = responsesById.get(phase.response);
			if (!response || !Array.isArray(phase.tracks) || !phase.tracks.length
				|| phase.tracks.some(track => typeof track.primitive !== 'string' || typeof track.property !== 'string')) {
				throw new Error(`Missing or invalid Motion response or tracks: ${preset.id}/${phase.phase}`);
			}
		}
	}
	const tokens = new Map(definitions.tokens.map(token => [token.id, token]));
	const bindingsByPreset = new Set();
	const projectedBindings = bindings.map(binding => {
		const preset = presetsById.get(binding.preset);
		if (!binding.id || !preset || bindingsByPreset.has(binding.preset) || !Array.isArray(binding.phases)
			|| binding.phases.length !== preset.phases.length) {
			throw new Error(`Missing Motion preset or complete binding phases: ${binding.id}`);
		}
		bindingsByPreset.add(binding.preset);
		const assignments = new Map();
		const seen = new Set();
		const phases = binding.phases.map(bound => {
			const phase = preset.phases.find(phase => phase.phase === bound.phase);
			if (!phase || seen.has(bound.phase)) { throw new Error(`Invalid or duplicate Motion preset binding phase: ${binding.id}/${bound.phase}`); }
			seen.add(bound.phase);
			const response = responsesById.get(phase.response);
			for (const [ids, kind, value] of [[bound.durationTokens, 'duration', response.durationMs], [bound.easingTokens, 'easing', response.easing]]) {
				if (!Array.isArray(ids) || !ids.length) { throw new Error(`Missing ${kind} assignments: ${binding.id}`); }
				for (const id of ids) {
					const token = tokens.get(id);
					if (definitions.tokens.length && (!token || token.kind !== kind)) { throw new Error(`Invalid Motion ${kind} token: ${id}`); }
					if (token && (kind === 'duration' ? token.number !== value : token.value !== value)) {
						throw new Error(`Motion preset binding does not match the source default: ${id}`);
					}
					if (assignments.has(id) && assignments.get(id) !== value) { throw new Error(`Conflicting response phases for Motion token: ${id}`); }
					assignments.set(id, value);
				}
			}
			return {
				phase: bound.phase, response: response.id, responseLabel: response.label, durationMs: response.durationMs,
				easing: response.easing, tracks: phase.tracks, durationTokens: bound.durationTokens, easingTokens: bound.easingTokens,
			};
		});
		return { id: binding.id, preset: binding.preset, label: preset.label, phases, source: context.source(motionPresetBindingFiles[1], Math.max(0, sourceOffset(texts[1], binding.id))) };
	});
	if (bindingsByPreset.size !== presets.length) { throw new Error('Every Motion preset must have one product token binding.'); }
	return {
		status: 'defined',
		presets: presets.map(preset => ({
			...preset,
			source: context.source(motionPresetBindingFiles[0], Math.max(0, sourceOffset(texts[0], preset.id))),
		})),
		bindings: projectedBindings,
	};
}
