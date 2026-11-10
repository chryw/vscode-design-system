/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import { workspaceRoot } from '../runtime/paths.mjs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { motionDefinitionFiles, motionGuidanceFile, motionPageFile, motionResponseFiles, motionSourceFiles, parseMotionDefinitions, projectMotionDefinitions, readMotionDefinitions, readMotionPage } from '../adapters/vscode/groups/motion-source.mjs';
import { load } from '../adapters/vscode/groups/motion.mjs';
import { pageJumps } from '../view/navigation-model.mjs';
import { motionRecipeExamples, motionExample } from '../view/motion-recipes.mjs';
import { motionPresetBindingFiles, readMotionPresetBindings } from '../adapters/vscode/groups/motion-preset-bindings.mjs';

const root = workspaceRoot;
const ts = createRequire(`${root}/package.json`)('typescript');
const source = (file, offset) => ({ file, line: offset + 1 });

function fixture(duration = 100) {
	const tokens = [
		['motion.duration.faster', 'duration', duration],
		['motion.duration.normal', 'duration', 200],
		['motion.duration.gentle', 'duration', 250],
		['motion.progress.duration', 'duration', 4000],
		['motion.control.duration', 'duration', { ref: 'motion.duration.faster' }],
		['motion.control.easing', 'easing', { ref: 'motion.easing.easeInOut' }],
		['motion.easing.easeInOut', 'easing', 'ease'],
		['motion.easing.linear', 'easing', 'linear'],
		['motion.surface.enter.scale', 'scale', 0.97],
	].map(([id, kind, value]) => ({ id, kind, value, description: 'Source definition' }));
	const registry = `export const motionTokenRegistry = new MotionTokenRegistry(${JSON.stringify(tokens).replace('"INFINITE"', 'Infinity')});`;
	const recipe = (id, duration, easing, frames = []) => ({ id, purpose: id, duration, easing, frames, reduced: 'instant' });
	const recipes = [
		recipe('motion.control', 'motion.control.duration', 'motion.control.easing'),
		recipe('motion.selection', 'motion.control.duration', 'motion.easing.easeInOut'),
		recipe('motion.surface.enter', 'motion.duration.gentle', 'motion.easing.easeInOut', [{ opacity: 0, scale: 'motion.surface.enter.scale' }, { opacity: 1, scale: 1 }]),
		recipe('motion.surface.exit', 'motion.duration.faster', 'motion.easing.easeInOut'),
		{ ...recipe('motion.progress.spin', 'motion.progress.duration', 'motion.easing.linear', [{ angle: 0 }, { angle: 360 }]), iterations: 'INFINITE' },
	];
	return { registry, recipes: `export const motionRecipes = ${JSON.stringify(recipes).replace('"INFINITE"', 'Infinity')};` };
}

test('motion definitions resolve actual recipe aliases and literal endpoints', () => {
	const { registry, recipes } = fixture();
	const model = parseMotionDefinitions(ts, registry, recipes, source);
	assert.deepEqual({
		status: model.status,
		recipes: model.recipes.map(recipe => [recipe.id, recipe.duration]),
		alias: model.tokens.find(token => token.id === 'motion.control.duration').value,
		loop: model.recipes.find(recipe => recipe.id === 'motion.progress.spin').loop,
		start: model.recipes.find(recipe => recipe.id === 'motion.surface.enter').frames[0].opacity,
	}, {
		status: 'defined',
		recipes: [['motion.control', 100], ['motion.selection', 100], ['motion.surface.enter', 250], ['motion.surface.exit', 100], ['motion.progress.spin', 4000]],
		alias: '100ms', loop: true, start: 0,
	});
});

test('a saved source value changes documentation without rebuilding product output', () => {
	const before = fixture();
	const after = fixture(125);
	assert.deepEqual([
		parseMotionDefinitions(ts, before.registry, before.recipes, source).recipes[0].duration,
		parseMotionDefinitions(ts, after.registry, after.recipes, source).recipes[0].duration,
	], [100, 125]);
});

test('stepped easing is source data, not an object coerced into a curve name', () => {
	const { registry, recipes } = fixture();
	const model = parseMotionDefinitions(ts, registry.replace('"value":"linear"', '"value":{"steps":30}'), recipes, source);
	assert.deepEqual(model.easings.find(easing => easing.id === 'motion.easing.linear'), {
		id: 'motion.easing.linear', description: 'Source definition', value: 'steps(30)', steps: 30, curve: null,
	});
});

test('localized strings and shared frame constants are read as data', () => {
	const { registry } = fixture();
	const recipes = `const visible = { opacity: 1, scale: 1 };
		export const motionRecipes = ${fixture().recipes.split(' = ')[1]}`;
	const localized = registry.replace('"Source definition"', 'localize("token.description", "Readable source text")');
	const model = parseMotionDefinitions(ts, localized, recipes.replace('"frames":[]', '"frames":[{...visible}]'), source);
	assert.equal(model.tokens[0].description, 'Readable source text');
	assert.equal(model.recipes[0].frames[0].opacity, 1);
});

test('unsupported executable expressions and broken alias graphs fail explicitly', () => {
	const { registry, recipes } = fixture();
	assert.throws(() => parseMotionDefinitions(ts, registry.replace('"value":100', '"value":(() => { throw new Error("must not execute"); })()'), recipes, source), /Unsupported motion expression/);
	assert.throws(() => parseMotionDefinitions(ts, registry.replace('"ref":"motion.duration.faster"', '"ref":"missing"'), recipes, source), /Missing, incompatible, or cyclic/);
	assert.throws(() => parseMotionDefinitions(ts, registry.replace('"ref":"motion.duration.faster"', '"ref":"motion.control.duration"'), recipes, source), /cyclic/);
});

test('absent definitions are scoped absence; unreadable definitions are not absence', () => {
	const readPaths = [];
	const context = {
		root,
		read: file => { readPaths.push(file); const error = new Error('Missing'); error.code = 'ENOENT'; throw error; },
		source,
	};
	assert.equal(readMotionDefinitions(context).status, 'absent');
	assert.deepEqual(readPaths, motionDefinitionFiles);
	assert.throws(() => readMotionDefinitions({ ...context, read: () => { const error = new Error('Denied'); error.code = 'EACCES'; throw error; } }), /Denied/);
});

test('token-only checkouts do not invent published recipes', () => {
	const { registry } = fixture();
	const model = readMotionDefinitions({
		root,
		read: file => {
			if (file === motionDefinitionFiles[0]) { return registry; }
			const error = new Error('Missing'); error.code = 'ENOENT'; throw error;
		},
		source,
	});
	assert.deepEqual({ status: model.status, recipes: model.recipes, sources: model.sources }, { status: 'partial', recipes: [], sources: [motionDefinitionFiles[0]] });
});

test('motion navigation follows the system hierarchy', () => {
	const jumps = pageJumps({ section: 'motion' }, load(context()).page);
	assert.deepEqual(jumps, [
		{ anchor: 'motion-principles', label: 'Principles' },
		{ anchor: 'motion-foundations', label: 'Foundations' },
		{ anchor: 'motion-practices', label: 'Best practices' },
		{ anchor: 'motion-accessibility', label: 'Accessibility' },
	]);
});

function context(overrides = {}, reads = new Set()) {
	return { root, source, read: file => { reads.add(file); return overrides[file] ?? readFileSync(`${root}/${file}`, 'utf8'); } };
}

test('Motion composition and guidance are tracked source dependencies, not renderer prose', () => {
	const reads = new Set();
	const { motionDocumentation: model } = load(context({}, reads));
	const examples = motionRecipeExamples(model);
	assert.deepEqual({
		dependencies: [motionPageFile, motionGuidanceFile].map(file => reads.has(file)),
		sections: model.page.sections.map(section => [section.id, section.title ?? model.sections[section.heading].title]),
		recipeSources: [...new Set(examples.map(recipe => recipe.source.file))],
		css: examples.map(recipe => [recipe.id, Boolean(recipe.code)]),
	}, {
		dependencies: [true, true],
		sections: [['principles', 'Principles'], ['foundations', 'Foundations'], ['practices', 'Best practices'], ['accessibility', 'Accessibility']],
		recipeSources: [motionGuidanceFile],
		css: [['surface', true], ['layout', true], ['content', true], ['feedback', true], ['notification', true]],
	});
	assert.match(model.sections['content-replacement'].markdown, /Editor tabs, typing, search keystrokes, and streaming remain immediate/);
	assert.doesNotMatch(readFileSync(`${root}/${motionGuidanceFile}`, 'utf8'), /canvas recipe reference|motion-recipes\.mjs/);
});

test('chapter copy is curated while specifications and timing remain source-backed', () => {
	const file = 'src/vs/platform/theme/common/motion/motion-examples.md';
	const original = context();
	const reads = new Set();
	const { motionDocumentation: before } = load(context({}, reads));
	const { motionDocumentation: after } = load(context({
		[file]: original.read(file).replace('Match the time to the job.', 'Feedback acknowledges input promptly.')
			.replace('Only the selection indicator travels;', 'Example-only caption.'),
	}));
	assert.deepEqual({
		tracked: reads.has(file),
		copyChanged: after.page.sections[1].blocks[0].blocks[0].description.startsWith('Feedback acknowledges input promptly.'),
		captionChanged: motionExample(after, 'selection').caption.startsWith('Example-only caption.'),
		guidanceUnchanged: after.page.properties.find(property => property.id === 'position').description === before.page.properties.find(property => property.id === 'position').description,
		timingUnchanged: after.responses.map(response => response.durationMs),
		specificationAvailable: !!after.sections['component-binding'] && !!after.sections['authoring-and-validation'],
	}, {
		tracked: true, copyChanged: true, captionChanged: true, guidanceUnchanged: true,
		timingUnchanged: before.responses.map(response => response.durationMs),
		specificationAvailable: true,
	});
	assert.throws(() => readMotionPage(context({
		[file]: original.read(file).replace('## Duration', '## Missing'),
	}), readMotionDefinitions(original)), /Expected one section "Duration"/);
});

test('saved Markdown, CSS examples, and declarative composition refresh without a product rebuild', () => {
	const original = context();
	const spec = original.read(motionGuidanceFile)
		.replace('Make changes easier to understand.', 'Clarify meaningful change.')
		.replace('Use a small cue beside a stable status label', 'Use one compact cue beside a stable status label')
		.replace('.surface {', '.surface.test-change {');
	const page = JSON.parse(original.read(motionPageFile));
	page.sections[0].blocks.reverse();
	const { motionDocumentation: changed } = load(context({
		[motionGuidanceFile]: spec, [motionPageFile]: JSON.stringify(page),
	}));
	assert.deepEqual({
		principle: changed.sections.purposeful.markdown.startsWith('Clarify meaningful change.'),
		order: changed.page.sections[0].blocks.map(block => block.heading),
		example: changed.sections['compact-activity'].markdown.split('\n\n')[0],
		cssChanged: motionRecipeExamples(changed)[0].code.startsWith('.surface.test-change {'),
	}, {
		principle: true,
		order: ['accessible', 'consistent', 'responsive', 'natural', 'purposeful'],
		example: 'Use one compact cue beside a stable status label when the amount of work is unknown.',
		cssChanged: true,
	});
});

test('broken heading, block, example, and token references fail rather than publishing empty guidance', () => {
	const definitions = readMotionDefinitions(context());
	for (const [mutate, error] of [
		[page => { page.sections[0].blocks[0].heading = 'missing'; }, /Missing Motion heading/],
		[page => { page.sections[0].blocks[0].type = 'executable'; }, /Unsupported Motion block/],
		[page => { page.recipes[0].examples = ['missing']; }, /Missing Motion examples/],
		[page => { page.recipes[0].tokens = ['motion.missing']; }, /Missing Motion token/],
		[page => { delete page.durationIntro; }, /Missing Motion duration comparisons/],
		[page => { page.durations[0].exampleId = 'control'; }, /Motion duration studies need/],
		[page => { page.durations[0].tokens = ['motion.easing.linear']; }, /Missing Motion duration token/],
		[page => { page.source = '../outside.md'; }, /Unsupported Motion page descriptor/],
		[page => { page.examples.push(page.examples[0]); }, /duplicate Motion examples/],
		[page => { page.responses = [{ id: 'missing' }]; }, /Missing Motion response/],
		[page => { page.sections[1].blocks.push({ type: 'responses', heading: 'duration' }); }, /Missing Motion response specimens/],
	]) {
		const page = JSON.parse(context().read(motionPageFile));
		mutate(page);
		assert.throws(() => readMotionPage(context({ [motionPageFile]: JSON.stringify(page) }), definitions), error);
	}
	const spec = context().read(motionGuidanceFile);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: `${spec}\n### Purposeful\nDuplicate` }), definitions), /Ambiguous Motion heading/);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: spec.replace('```css', '```text') }), definitions), /Expected one CSS example/);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: `${spec}\n\`\`\`css\nunclosed` }), definitions), /Unclosed fence/);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: spec.replace('var(--vscode-motion-surface-exit-duration', 'var(--vscode-motion-missing') }), definitions), /Missing Motion CSS variable/);
});

test('generated response pairs are digest-checked and resolve source references without executing source', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const byId = new Map(definitions.tokens.map(token => [token.id, token]));
	const responses = new Map(definitions.responses.map(response => [response.id, response]));
	assert.deepEqual({
		sources: definitions.scope,
		pairs: ['responsive', 'settled'].map(id => ({
			id,
			duration: byId.get(`motion.response.${id}.duration`).number,
			easing: byId.get(`motion.response.${id}.easing`).value,
			responseDuration: responses.get(id).durationMs,
			responseEasing: responses.get(id).easing,
		})),
	}, {
		sources: motionSourceFiles,
		pairs: ['responsive', 'settled'].map(id => ({
			id,
			duration: responses.get(id).durationMs,
			easing: responses.get(id).easing,
			responseDuration: responses.get(id).durationMs,
			responseEasing: responses.get(id).easing,
		})),
	});
	const staleParameters = original.read(motionResponseFiles[0]).replace('"frequencyHz": 6', '"frequencyHz": 7');
	assert.throws(() => readMotionDefinitions(context({
		[motionResponseFiles[0]]: staleParameters,
	})), /exports are stale/);
	assert.throws(() => readMotionDefinitions({
		...original,
		read: file => {
			if (file === motionResponseFiles[1]) { const error = new Error('Missing'); error.code = 'ENOENT'; throw error; }
			return original.read(file);
		},
	}), /response sources are incomplete/);
});

test('CRLF motion sources match LF exports and still reject changed parameters', () => {
	const original = context();
	const parameters = original.read(motionResponseFiles[0]).replace(/\r\n/g, '\n');
	const generated = original.read(motionResponseFiles[1]).replace(/\r\n/g, '\n');
	const responses = readMotionDefinitions(context({
		[motionResponseFiles[0]]: parameters,
		[motionResponseFiles[1]]: generated,
	})).responses;
	for (const sourceEnding of ['\n', '\r\n']) {
		for (const outputEnding of ['\n', '\r\n']) {
			const overrides = {
				[motionResponseFiles[0]]: parameters.replace(/\n/g, sourceEnding),
				[motionResponseFiles[1]]: generated.replace(/\n/g, outputEnding),
			};
			assert.deepEqual(readMotionDefinitions(context(overrides)).responses, responses);
			assert.throws(() => readMotionDefinitions(context({
				...overrides,
				[motionResponseFiles[0]]: overrides[motionResponseFiles[0]].replace('"frequencyHz": 6', '"frequencyHz": 7'),
			})), /exports are stale/);
		}
	}
});

test('canonical presets project product token bindings from actual source defaults', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const model = readMotionPresetBindings(original, definitions);
	const tokens = new Map(definitions.tokens.map(token => [token.id, token]));
	assert.deepEqual({
		presets: model.presets.map(preset => preset.id),
		bindings: model.bindings.map(binding => binding.id),
		defaults: model.bindings.flatMap(binding => binding.phases.flatMap(phase => [
			...phase.durationTokens.map(id => [id, tokens.get(id).number, phase.durationMs]),
			...phase.easingTokens.map(id => [id, tokens.get(id).value, phase.easing]),
		])),
	}, {
		presets: ['control', 'selection', 'surface', 'disclosure', 'notification', 'replacement', 'visibility'],
		bindings: ['control', 'selection', 'surface', 'disclosure', 'notification', 'replacement', 'visibility'],
		defaults: model.bindings.flatMap(binding => binding.phases.flatMap(phase => [
			...phase.durationTokens.map(id => [id, phase.durationMs, phase.durationMs]),
			...phase.easingTokens.map(id => [id, phase.easing, phase.easing]),
		])),
	});
});

test('missing responses, incompatible defaults, and incomplete preset bindings fail explicitly', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const bindings = original.read(motionPresetBindingFiles[1]);
	for (const [changed, error] of [
		[bindings.replace(`phase: 'exit'`, `phase: 'missing'`), /Invalid or duplicate Motion preset binding phase/],
		[bindings.replace(`'motion.surface.exit.duration'`, `'motion.surface.enter.duration'`), /Motion preset binding does not match the source default/],
		[bindings.replace(`['motion.control.easing', 'motion.border.easing']`, '[]'), /Missing easing assignments/],
	]) {
		assert.throws(() => readMotionPresetBindings(context({ [motionPresetBindingFiles[1]]: changed }), definitions), error);
	}
	const presets = original.read(motionPresetBindingFiles[0]).replace(`phase: 'enter', response: 'settled'`, `phase: 'enter', response: 'missing'`);
	assert.throws(() => readMotionPresetBindings(context({ [motionPresetBindingFiles[0]]: presets }), definitions), /Missing or invalid Motion response/);
});

test('missing preset support is distinct from an incomplete or unreadable source foundation', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const missing = () => { const error = new Error('Missing'); error.code = 'ENOENT'; throw error; };
	assert.deepEqual(readMotionPresetBindings({ ...original, read: missing }, definitions), { status: 'absent', presets: [], bindings: [] });
	assert.throws(() => readMotionPresetBindings({ ...original, read: file => file === motionPresetBindingFiles[1] ? missing() : original.read(file) }, definitions), /preset definitions and bindings are incomplete/);
	assert.throws(() => readMotionPresetBindings({ ...original, read: () => { const error = new Error('Denied'); error.code = 'EACCES'; throw error; } }, definitions), /Denied/);
});

test('analysis examples bind existing product recipes and real example identities', () => {
	const original = context();
	const page = JSON.parse(original.read(motionPageFile));
	const definitions = readMotionDefinitions(original);
	const read = () => readMotionPage(context({ [motionPageFile]: JSON.stringify(page) }), definitions);
	assert.deepEqual(read().page.analyses, page.analyses);
	page.analyses.at(-1).recipeId = 'missing';
	assert.throws(read, /Missing Motion analysis recipe/);
	page.analyses.at(-1).recipeId = 'motion.toast.enter';
	page.analyses.at(-1).exampleId = 'missing';
	assert.throws(read, /Missing Motion analysis example/);
	page.analyses.at(-1).exampleId = 'notification';
	page.analyses.push({ id: 'another-selection', recipeId: 'motion.selection', exampleId: 'selection' });
	assert.throws(read, /Duplicate Motion analysis example/);
	page.analyses.pop();
	page.examples.find(example => example.id === 'anchored-menu').presetBindingId = 'missing';
	assert.throws(() => load(context({ [motionPageFile]: JSON.stringify(page) })), /Missing Motion preset binding/);
});

test('analysis follows saved source timing and groups only tracks with shared parameters', () => {
	const original = context();
	const before = load(original).motionDocumentation;
	const duration = before.tokens.find(token => token.id === 'motion.duration.faster').number;
	const declaration = `id: 'motion.duration.faster', kind: 'duration', value: `;
	const registry = original.read(motionDefinitionFiles[0]).replace(`${declaration}${duration}`, `${declaration}${duration * 2}`);
	const after = load(context({ [motionDefinitionFiles[0]]: registry })).motionDocumentation;
	const first = before.analyses.find(entry => entry.id === 'motion.selection');
	const changed = after.analyses.find(entry => entry.id === 'motion.selection');
	const track = first.tracks.find(track => track.properties.includes('scale')).analysis;
	const updated = changed.tracks.find(track => track.properties.includes('scale')).analysis;
	assert.deepEqual({
		properties: changed.tracks.map(track => track.properties),
		source: changed.source.file,
		duration: updated.durationMs,
		response: updated.response50Ms,
		settle: updated.settle2PercentMs,
		peak: updated.speed.peak.value,
	}, {
		properties: [['transform', 'width'], ['scale']],
		source: motionDefinitionFiles[1],
		duration: track.durationMs * 2,
		response: track.response50Ms * 2,
		settle: track.settle2PercentMs * 2,
		peak: track.speed.peak.value / 2,
	});
});

test('unsupported response analysis never invents measurements', () => {
	for (const recipe of load(context()).motionDocumentation.analyses) {
		for (const track of recipe.tracks) {
			const result = track.analysis;
			if (result.status === 'unsupported') {
				assert.deepEqual({
					status: result.status,
					reason: result.reason,
					hasMeasurements: 'speed' in result || 'response50Ms' in result || 'durationMs' in result,
				}, {
					status: 'unsupported',
					reason: 'Piecewise linear() timing is not supported by this cubic Bézier analysis.',
					hasMeasurements: false,
				}, `${recipe.id}: ${track.properties.join(', ')}`);
			} else {
				assert.deepEqual({
					status: result.status, monotonic: result.monotonic,
					overshoot: result.overshoot, finalSpeed: result.speed?.final,
				}, {
					status: 'supported', monotonic: true,
					overshoot: { aboveTarget: 0, belowStart: 0 }, finalSpeed: { status: 'finite', value: 0 },
				}, `${recipe.id}: ${track.properties.join(', ')}`);
			}
		}
	}
});

test('fenced heading-like text is code, and CRLF source headings retain their authored text', () => {
	const spec = context().read(motionGuidanceFile).replace('.surface {', '# not-a-guidance-heading\n.surface {').replaceAll('\n', '\r\n');
	const model = readMotionPage({
		...context({ [motionGuidanceFile]: spec }),
		source: (file, offset) => ({ file, line: spec.slice(0, offset).split('\n').length }),
	}, readMotionDefinitions(context()));
	assert.deepEqual({
		headingCreated: Boolean(model.sections['not-a-guidance-heading']),
		purposeful: model.sections.purposeful.markdown.startsWith('Make changes easier to understand.'),
		sourceLine: model.sections['notification-arrival-composition'].source.line,
	}, {
		headingCreated: false,
		purposeful: true,
		sourceLine: spec.split('\n').findIndex(line => line.startsWith('### Notification arrival composition')) + 1,
	});
});

test('ordinary ramps, literal purpose defaults, and long compatibility cycles remain distinct', () => {
	const tokens = [
		{ id: 'motion.duration.normal', kind: 'duration', value: 200 },
		{ id: 'motion.progress.duration', kind: 'duration', value: 4000 },
		{ id: 'motion.control.duration', kind: 'duration', value: 120 },
		{ id: 'motion.surface.enter.duration', kind: 'duration', value: { ref: 'motion.duration.normal' } },
	].map(token => ({ ...token, description: token.id, source: { file: 'registry.ts', line: 1 } }));
	const model = projectMotionDefinitions(tokens, []);
	assert.deepEqual({
		categories: model.tokens.map(token => [token.id, token.category, token.value]),
		durations: model.durations.map(token => token.id),
	}, {
		categories: [
			['motion.duration.normal', 'ramp', '200ms'], ['motion.progress.duration', 'purpose', '4000ms'],
			['motion.control.duration', 'purpose', '120ms'], ['motion.surface.enter.duration', 'purpose', '200ms'],
		],
		durations: ['motion.duration.normal'],
	});
});

test('property tracks retain distinct press timing rather than being relabeled with selection timing', () => {
	const { registry, recipes } = fixture();
	const withTracks = recipes.replace('"id":"motion.selection"', '"id":"motion.selection","tracks":[{"property":"scale","duration":"motion.duration.normal","easing":"motion.easing.linear"}]');
	const model = parseMotionDefinitions(ts, registry, withTracks, source);
	assert.deepEqual(model.recipes.find(recipe => recipe.id === 'motion.selection').tracks, [
		{ property: 'scale', duration: 200, easing: 'linear', durationToken: 'motion.duration.normal', easingToken: 'motion.easing.linear' },
	]);
});
