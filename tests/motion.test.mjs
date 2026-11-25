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
import { motionDefinitionFiles, motionResponseFiles, motionSourceFiles, parseMotionDefinitions, projectMotionDefinitions, readMotionDefinitions, readMotionPage } from '../adapters/vscode/groups/motion-source.mjs';
import { load } from '../adapters/vscode/groups/motion.mjs';
import { pageJumps } from '../view/navigation-model.mjs';
import { motionRecipeExamples, motionExample } from '../view/motion-recipes.mjs';
import { motionPresetBindingFiles, readMotionPresetBindings } from '../adapters/vscode/groups/motion-preset-bindings.mjs';
import { hasRichMotion, legacyMotionDescriptor, legacyMotionPageFile, legacyMotionProjection, motionComposition, motionGuidanceFile, motionImplementationFile, motionProjection, motionTextFile, moveMotionStylesFirst, withMotionComposition } from './motion-helpers.mjs';

const root = workspaceRoot;
const ts = createRequire(`${root}/package.json`)('typescript');
const source = (file, offset) => ({ file, line: offset + 1 });
const guidance = () => readFileSync(`${root}/${motionGuidanceFile}`, 'utf8');
const composed = mutate => ({ [motionGuidanceFile]: withMotionComposition(guidance(), mutate) });
const motionTest = (name, run) => test(name, { skip: hasRichMotion ? false : 'The selected checkout declares guidance-only Motion' }, run);

function fixture(duration = 100) {
	const tokens = [
		['motion.duration.short', 'duration', duration],
		['motion.duration.medium', 'duration', 200],
		['motion.duration.gentle', 'duration', 250],
		['motion.progress.cycle.duration', 'duration', 4000],
		['motion.state.change.duration', 'duration', { ref: 'motion.duration.short' }],
		['motion.state.change.easing', 'easing', { ref: 'motion.easing.easeInOut' }],
		['motion.easing.easeInOut', 'easing', 'ease'],
		['motion.easing.linear', 'easing', 'linear'],
		['motion.surface.enter.scale', 'scale', 0.97],
	].map(([id, kind, value]) => ({ id, kind, value, description: 'Source definition' }));
	const registry = `export const motionTokenRegistry = new MotionTokenRegistry(${JSON.stringify(tokens).replace('"INFINITE"', 'Infinity')});`;
	const recipe = (id, duration, easing, frames = []) => ({ id, purpose: id, duration, easing, frames, reduced: 'instant' });
	const recipes = [
		recipe('motion.state.change', 'motion.state.change.duration', 'motion.state.change.easing'),
		recipe('motion.selection.change', 'motion.state.change.duration', 'motion.easing.easeInOut'),
		recipe('motion.surface.enter', 'motion.duration.gentle', 'motion.easing.easeInOut', [{ opacity: 0, scale: 'motion.surface.enter.scale' }, { opacity: 1, scale: 1 }]),
		recipe('motion.surface.exit', 'motion.duration.short', 'motion.easing.easeInOut'),
		{ ...recipe('motion.spinner.cycle', 'motion.progress.cycle.duration', 'motion.easing.linear', [{ angle: 0 }, { angle: 360 }]), iterations: 'INFINITE' },
	];
	return { registry, recipes: `export const motionRecipes = ${JSON.stringify(recipes).replace('"INFINITE"', 'Infinity')};` };
}

test('motion definitions resolve actual recipe aliases and literal endpoints', () => {
	const { registry, recipes } = fixture();
	const model = parseMotionDefinitions(ts, registry, recipes, source);
	assert.deepEqual({
		status: model.status,
		recipes: model.recipes.map(recipe => [recipe.id, recipe.duration]),
		alias: model.tokens.find(token => token.id === 'motion.state.change.duration').value,
		loop: model.recipes.find(recipe => recipe.id === 'motion.spinner.cycle').loop,
		start: model.recipes.find(recipe => recipe.id === 'motion.surface.enter').frames[0].opacity,
	}, {
		status: 'defined',
		recipes: [['motion.state.change', 100], ['motion.selection.change', 100], ['motion.surface.enter', 250], ['motion.surface.exit', 100], ['motion.spinner.cycle', 4000]],
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
	assert.throws(() => parseMotionDefinitions(ts, registry.replace('"ref":"motion.duration.short"', '"ref":"missing"'), recipes, source), /Missing, incompatible, or cyclic/);
	assert.throws(() => parseMotionDefinitions(ts, registry.replace('"ref":"motion.duration.short"', '"ref":"motion.state.change.duration"'), recipes, source), /cyclic/);
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

motionTest('motion navigation follows the system hierarchy', () => {
	const jumps = pageJumps({ section: 'motion' }, load(context()).page);
	assert.deepEqual(jumps, [
		{ anchor: 'motion-principles', label: 'Choose by intent' },
		{ anchor: 'motion-foundations', label: 'Foundations' },
		{ anchor: 'motion-implementation', label: 'Motion presets' },
		{ anchor: 'motion-practices', label: 'Product usage' },
		{ anchor: 'motion-accessibility', label: 'Accessibility' },
		{ anchor: 'motion-review', label: 'Authoring and validation' },
	]);
});

function context(overrides = {}, reads = new Set(), projection = motionProjection) {
	return {
		root, source, repository: { projection },
		read: file => { reads.add(file); return overrides[file] ?? readFileSync(`${root}/${file}`, 'utf8'); },
	};
}

/** Older checkouts bind a page descriptor; these contexts supply it in memory from the owning specification. */
function legacyContext(overrides = {}, reads = new Set()) {
	return context({ [legacyMotionPageFile]: JSON.stringify(legacyMotionDescriptor(guidance())), ...overrides }, reads, legacyMotionProjection);
}

motionTest('Motion composition and guidance are tracked source dependencies, not renderer prose', () => {
	const reads = new Set();
	const { motionDocumentation: model } = load(context({}, reads));
	const examples = motionRecipeExamples(model);
	assert.deepEqual({
		dependencies: [motionGuidanceFile, motionImplementationFile, motionTextFile].map(file => reads.has(file)),
		pageFile: model.pageFile,
		sections: model.page.sections.map(section => [section.id, section.title ?? model.sections[section.heading].title]),
		recipeSources: [...new Set(examples.map(recipe => recipe.source.file))],
		css: examples.map(recipe => [recipe.id, Boolean(recipe.code)]),
	}, {
		dependencies: [true, true, true],
		pageFile: motionGuidanceFile,
		sections: [['principles', 'Choose by intent'], ['foundations', 'Foundations'], ['implementation', 'Motion presets'], ['practices', 'Product usage'], ['accessibility', 'Accessibility'], ['review', 'Authoring and validation']],
		recipeSources: [motionImplementationFile],
		css: [['surface', true], ['layout', true], ['content', true], ['feedback', true]],
	});
	assert.match(model.sections['content-replacement'].markdown, /Editor tabs, typing, search keystrokes, streaming, and background updates do not replay entrances/);
	assert.doesNotMatch(readFileSync(`${root}/${motionGuidanceFile}`, 'utf8'), /canvas recipe reference|motion-recipes\.mjs/);
});

motionTest('chapter copy is curated while specifications and timing remain source-backed', () => {
	const file = '.github/skills/design-system/foundations/motion/examples.md';
	const original = context();
	const reads = new Set();
	const { motionDocumentation: before } = load(context({}, reads));
	const { motionDocumentation: after } = load(context({
		[file]: original.read(file).replace('Duration is how long the visual change takes,', 'Feedback acknowledges input promptly,')
			.replace('The selection indicator connects', 'Example-only caption.'),
	}));
	assert.deepEqual({
		tracked: reads.has(file),
		copyChanged: after.page.sections.find(section => section.id === 'foundations').blocks.find(block => block.type === 'duration').description.startsWith('Feedback acknowledges input promptly,'),
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

motionTest('saved Markdown owns Motion heading titles, order, and additions without a registration edit', () => {
	const original = context();
	const spec = moveMotionStylesFirst(original.read(motionGuidanceFile)
		.replace('## Choose by intent', '## Choose deliberately')
		.replace('Name what becomes easier to recognize or follow.', 'Clarify meaningful change.')
		.replace('Use a small cue beside a stable status label', 'Use one compact cue beside a stable status label'))
		.replace('<a id="motion-foundations"></a>', '<a id="motion-new-guidance"></a>\n\n### New guidance\n\nA new source section.\n\n<a id="motion-foundations"></a>');
	const implementation = original.read(motionImplementationFile).replace('.surface {', '.surface.test-change {');
	const { motionDocumentation: changed } = load(context({
		[motionGuidanceFile]: spec, [motionImplementationFile]: implementation,
	}));
	assert.deepEqual({
		principle: changed.sections.purposeful.markdown.startsWith('Clarify meaningful change.'),
		title: changed.sections[changed.page.sections[0].heading].title,
		order: changed.page.sections[0].blocks.map(block => block.heading),
		example: changed.sections['compact-activity'].markdown.split('\n\n')[0],
		cssChanged: motionRecipeExamples(changed)[0].code.startsWith('.surface.test-change {'),
	}, {
		principle: true,
		title: 'Choose deliberately',
		order: ['motion-styles', 'when-to-use-motion', 'choosing-no-motion', 'principles', 'new-guidance'],
		example: 'Use one compact cue beside a stable status label when the amount of work is unknown.',
		cssChanged: true,
	});
});

motionTest('broken heading, block, example, and token references fail rather than publishing empty guidance', () => {
	const definitions = readMotionDefinitions(context());
	for (const [mutate, error] of [
		[page => { page.bindings.missing = { type: 'duration' }; }, /Missing Motion chapter anchor/],
		[page => { page.bindings.duration.type = 'executable'; }, /Unsupported Motion specimen binding/],
		[page => { page.composition = []; }, /Motion specimens must not redefine composition/],
		[page => { page.recipes[0].examples = ['missing']; }, /Missing Motion examples/],
		[page => { page.recipes[0].tokens = ['motion.missing']; }, /Missing Motion token/],
		[page => { delete page.durationIntro; }, /Missing Motion duration comparisons/],
		[page => { page.durations[0].exampleId = 'control'; }, /Motion duration studies need/],
		[page => { page.durations[0].tokens = ['motion.easing.linear']; }, /Missing Motion duration token/],
		[page => { page.source = '../outside.md'; }, /Motion specimens must not redefine source/],
		[page => { page.examples.push(page.examples[0]); }, /duplicate Motion examples/],
		[page => { page.responses = [{ id: 'missing' }]; }, /Missing Motion response/],
		[page => { page.bindings.duration.type = 'responses'; }, /Missing Motion response specimens/],
		[page => { page.textSource = '../outside.md'; }, /Invalid book source reference/],
	]) {
		assert.throws(() => readMotionPage(context(composed(mutate)), definitions), error);
	}
	const spec = context().read(motionGuidanceFile);
	assert.throws(() => readMotionPage(context({
		[motionGuidanceFile]: spec.replace('shared-principles:\n    description:\n      $text: "Principles in practice"', 'shared-principles: 1'),
	}), definitions), /Motion section copy can only supply description/);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: `${spec}\n### Purposeful\nDuplicate` }), definitions), /Ambiguous Motion heading/);
	const implementation = context().read(motionImplementationFile);
	assert.throws(() => readMotionPage(context({ [motionImplementationFile]: implementation.replace('```css', '```text') }), definitions), /Expected one CSS example/);
	assert.throws(() => readMotionPage(context({ [motionGuidanceFile]: `${spec}\n\`\`\`css\nunclosed` }), definitions), /Unclosed fence/);
	assert.throws(() => readMotionPage(context({ [motionImplementationFile]: implementation.replace('var(--vscode-motion-surface-exit-duration', 'var(--vscode-motion-missing') }), definitions), /Missing Motion CSS variable/);
});

motionTest('older checkouts bind relocated design and technical sources through a page descriptor', () => {
	const original = legacyContext();
	const definitions = readMotionDefinitions(original);
	const relocated = 'src/vs/platform/theme/common/motion/relocated.design.md';
	const page = { ...legacyMotionDescriptor(guidance()), source: relocated };
	const current = readMotionPage(legacyContext({
		[legacyMotionPageFile]: JSON.stringify(page),
		[relocated]: original.read(motionGuidanceFile),
	}), definitions);
	const legacyPage = { ...page, source: motionImplementationFile };
	delete legacyPage.sources;
	const legacy = readMotionPage(legacyContext({
		[legacyMotionPageFile]: JSON.stringify(legacyPage),
		[motionImplementationFile]: `${original.read(motionGuidanceFile)}\n${original.read(motionImplementationFile)}`,
	}), definitions);
	assert.deepEqual({
		pageFile: current.pageFile,
		design: current.sections.purposeful.source.file,
		recipe: current.sections['overlay-surface-composition'].source.file,
		singleSourceContent: Object.entries(current.sections).every(([id, section]) => section.markdown === legacy.sections[id].markdown),
	}, { pageFile: legacyMotionPageFile, design: relocated, recipe: motionImplementationFile, singleSourceContent: true });
	assert.throws(() => readMotionPage(context({
		[motionImplementationFile]: `${original.read(motionImplementationFile)}\n## Purposeful\nDuplicate.\n`,
	}), definitions), /Ambiguous Motion heading/);
	const authored = context();
	assert.throws(() => readMotionPage({
		...authored,
		read: file => {
			if (file === motionImplementationFile) { throw new Error('Technical source unavailable'); }
			return authored.read(file);
		},
	}, definitions), /Technical source unavailable/);
});

motionTest('the owning specification and an older page descriptor compose the same Motion chapter', () => {
	const { motionDocumentation: authored } = load(context());
	const { motionDocumentation: legacy } = load(legacyContext());
	assert.deepEqual({ authored: authored.pageFile, legacy: legacy.pageFile }, { authored: motionGuidanceFile, legacy: legacyMotionPageFile });
	assert.deepEqual({ ...authored, pageFile: undefined }, { ...legacy, pageFile: undefined });
});

motionTest('Motion scoped chapter copy preserves explicit composition and source-derived definitions', () => {
	const original = context();
	const file = motionTextFile;
	const descriptor = motionComposition(guidance());
	const references = (value, compact) => {
		if (Array.isArray(value)) { return value.map(item => references(item, compact)); }
		if (!value || typeof value !== 'object') { return value; }
		if (Object.hasOwn(value, '$text')) {
			const reference = typeof value.$text === 'string' ? { file, heading: value.$text } : value.$text;
			return { $text: compact && reference.file === file && Object.keys(reference).length === 2 ? reference.heading : reference };
		}
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, references(child, compact)]));
	};
	const explicit = references(descriptor, false);
	const scoped = { ...references(descriptor, true), textSource: file };
	const saved = page => ({ [motionGuidanceFile]: withMotionComposition(guidance(), page) });
	const definitions = readMotionDefinitions(original);
	// The composition is saved in the guidance front matter, so guidance heading offsets differ by its length.
	const withoutGuidanceOffsets = model => ({ ...model, sections: Object.fromEntries(Object.entries(model.sections).map(([id, section]) =>
		[id, section.source.file === motionGuidanceFile ? { ...section, source: { file: section.source.file } } : section])) });
	const before = readMotionPage(context(saved(explicit)), definitions);
	const after = readMotionPage(context(saved(scoped)), definitions);
	assert.deepEqual(withoutGuidanceOffsets(after), withoutGuidanceOffsets(before));
	const edited = readMotionPage(context({
		...saved(scoped),
		[file]: original.read(file).replace('Duration is how long the visual change takes,', 'Changed authored pacing guidance,'),
	}), definitions);
	assert.ok(edited.page.sections.find(section => section.id === 'foundations').blocks.find(block => block.type === 'duration').description.startsWith('Changed authored pacing guidance,'));
	assert.throws(() => readMotionPage(context(saved({ ...scoped, textSource: '../outside.md' })), definitions), /Invalid book source reference/);
	assert.throws(() => readMotionPage({
		...original,
		read: requested => {
			if (requested === motionGuidanceFile) { return saved(scoped)[motionGuidanceFile]; }
			if (requested === file) { throw new Error('Chapter copy unavailable'); }
			return original.read(requested);
		},
	}, definitions), /Chapter copy unavailable/);
});

motionTest('authoring candidates are digest-checked but are absent from shared product tokens', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const responses = new Map(definitions.responses.map(response => [response.id, response]));
	assert.deepEqual({
		sources: definitions.scope,
		candidateIds: [...responses.keys()],
		sharedCandidates: definitions.tokens.filter(token => token.id.startsWith('motion.response.') || token.value.startsWith('linear(')),
	}, {
		sources: motionSourceFiles,
		candidateIds: ['responsive', 'settled'],
		sharedCandidates: [],
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

motionTest('CRLF motion sources match LF exports and still reject changed parameters', () => {
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

motionTest('canonical presets project product token bindings from actual source defaults', () => {
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

motionTest('missing responses, incompatible defaults, and incomplete preset bindings fail explicitly', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const bindings = original.read(motionPresetBindingFiles[1]);
	for (const [changed, error] of [
		[bindings.replace(`phase: 'exit'`, `phase: 'missing'`), /Invalid or duplicate Motion preset binding phase/],
		[bindings.replace(`'motion.surface.exit.duration'`, `'motion.surface.enter.duration'`), /Motion preset binding does not match the source default/],
		[bindings.replace(`['motion.state.change.easing']`, '[]'), /Missing easing assignments/],
	]) {
		assert.throws(() => readMotionPresetBindings(context({ [motionPresetBindingFiles[1]]: changed }), definitions), error);
	}
	const presets = original.read(motionPresetBindingFiles[0]).replace(`phase: 'enter', response: 'motion.surface.enter'`, `phase: 'enter', response: 'missing'`);
	assert.throws(() => readMotionPresetBindings(context({ [motionPresetBindingFiles[0]]: presets }), definitions), /Missing or invalid Motion response/);
});

motionTest('missing preset support is distinct from an incomplete or unreadable source foundation', () => {
	const original = context();
	const definitions = readMotionDefinitions(original);
	const missing = () => { const error = new Error('Missing'); error.code = 'ENOENT'; throw error; };
	assert.deepEqual(readMotionPresetBindings({ ...original, read: missing }, definitions), { status: 'absent', presets: [], bindings: [] });
	assert.throws(() => readMotionPresetBindings({ ...original, read: file => file === motionPresetBindingFiles[1] ? missing() : original.read(file) }, definitions), /preset definitions and bindings are incomplete/);
	assert.throws(() => readMotionPresetBindings({ ...original, read: () => { const error = new Error('Denied'); error.code = 'EACCES'; throw error; } }, definitions), /Denied/);
});

motionTest('analysis examples bind existing product recipes and real example identities', () => {
	const original = context();
	const page = motionComposition(guidance());
	const definitions = readMotionDefinitions(original);
	const saved = () => context({ [motionGuidanceFile]: withMotionComposition(guidance(), page) });
	const read = () => readMotionPage(saved(), definitions);
	assert.deepEqual(read().page.analyses, page.analyses);
	page.analyses.at(-1).recipeId = 'missing';
	assert.throws(read, /Missing Motion analysis recipe/);
	page.analyses.at(-1).recipeId = 'motion.notification.enter';
	page.analyses.at(-1).exampleId = 'missing';
	assert.throws(read, /Missing Motion analysis example/);
	page.analyses.at(-1).exampleId = 'notification';
	page.analyses.push({ id: 'another-selection', recipeId: 'motion.selection.change', exampleId: 'selection' });
	assert.throws(read, /Duplicate Motion analysis example/);
	page.analyses.pop();
	page.examples.find(example => example.id === 'anchored-menu').presetBindingId = 'missing';
	assert.throws(() => load(saved()), /Missing Motion preset binding/);
});

motionTest('analysis follows saved source timing and groups only tracks with shared parameters', () => {
	const original = context();
	const before = load(original).motionDocumentation;
	const duration = before.tokens.find(token => token.id === 'motion.duration.short').number;
	const declaration = `id: 'motion.duration.short', kind: 'duration', value: `;
	const registry = original.read(motionDefinitionFiles[0]).replace(`${declaration}${duration}`, `${declaration}${duration * 2}`);
	const after = load(context({ [motionDefinitionFiles[0]]: registry })).motionDocumentation;
	const first = before.analyses.find(entry => entry.id === 'motion.selection.change');
	const changed = after.analyses.find(entry => entry.id === 'motion.selection.change');
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
		properties: [['translate', 'width'], ['scale']],
		source: motionDefinitionFiles[1],
		duration: track.durationMs * 2,
		response: track.response50Ms * 2,
		settle: track.settle2PercentMs * 2,
		peak: track.speed.peak.value / 2,
	});
});

motionTest('unsupported response analysis never invents measurements', () => {
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

motionTest('fenced heading-like text is code, and CRLF source headings retain their authored text', () => {
	const spec = context().read(motionGuidanceFile).replaceAll('\n', '\r\n');
	const implementation = context().read(motionImplementationFile).replace('.surface {', '# not-a-guidance-heading\n.surface {').replaceAll('\n', '\r\n');
	const model = readMotionPage({
		...context({ [motionGuidanceFile]: spec, [motionImplementationFile]: implementation }),
		source: (file, offset) => ({ file, line: (file === motionGuidanceFile ? spec : implementation).slice(0, offset).split('\n').length }),
	}, readMotionDefinitions(context()));
	assert.deepEqual({
		headingCreated: Boolean(model.sections['not-a-guidance-heading']),
		purposeful: model.sections.purposeful.markdown.startsWith('Name what becomes easier to recognize or follow.'),
		sourceLine: model.sections['notification-arrival-composition'].source.line,
	}, {
		headingCreated: false,
		purposeful: true,
		sourceLine: implementation.split('\n').findIndex(line => /^#{1,6} Notification arrival composition\r?$/.test(line)) + 1,
	});
});

test('ordinary ramps, literal purpose defaults, and long compatibility cycles remain distinct', () => {
	const tokens = [
		{ id: 'motion.duration.medium', kind: 'duration', value: 200 },
		{ id: 'motion.progress.cycle.duration', kind: 'duration', value: 4000 },
		{ id: 'motion.state.change.duration', kind: 'duration', value: 120 },
		{ id: 'motion.surface.enter.duration', kind: 'duration', value: { ref: 'motion.duration.medium' } },
	].map(token => ({ ...token, description: token.id, source: { file: 'registry.ts', line: 1 } }));
	const model = projectMotionDefinitions(tokens, []);
	assert.deepEqual({
		categories: model.tokens.map(token => [token.id, token.category, token.value]),
		durations: model.durations.map(token => token.id),
	}, {
		categories: [
			['motion.duration.medium', 'ramp', '200ms'], ['motion.progress.cycle.duration', 'purpose', '4000ms'],
			['motion.state.change.duration', 'purpose', '120ms'], ['motion.surface.enter.duration', 'purpose', '200ms'],
		],
		durations: ['motion.duration.medium'],
	});
});

test('property tracks retain distinct press timing rather than being relabeled with selection timing', () => {
	const { registry, recipes } = fixture();
	const withTracks = recipes.replace('"id":"motion.selection.change"', '"id":"motion.selection.change","tracks":[{"property":"scale","duration":"motion.duration.medium","easing":"motion.easing.linear"}]');
	const model = parseMotionDefinitions(ts, registry, withTracks, source);
	assert.deepEqual(model.recipes.find(recipe => recipe.id === 'motion.selection.change').tracks, [
		{ property: 'scale', duration: 200, easing: 'linear', durationToken: 'motion.duration.medium', easingToken: 'motion.easing.linear' },
	]);
});
