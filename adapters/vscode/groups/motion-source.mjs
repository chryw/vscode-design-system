/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { motionTokenCategory } from '../../../view/motion-reference.mjs';
import { resolveContent } from './authored.mjs';

export const motionPageFile = '.github/design-system/pages/motion.json';
export const motionGuidanceFile = 'src/vs/platform/theme/common/motion/MOTION.md';

export const motionDefinitionFiles = [
	'src/vs/platform/theme/common/motionRegistry.ts',
	'src/vs/platform/theme/common/motion/motionRecipes.ts',
];

export const motionResponseFiles = [
	'src/vs/platform/theme/common/motion/motionResponsePresets.json',
	'src/vs/platform/theme/common/motion/motionResponses.ts',
];

export const motionSourceFiles = [...motionDefinitionFiles, ...motionResponseFiles];

function motionModule(ts, text, file) {
	const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	if (ast.parseDiagnostics.length) {
		throw new Error(`Cannot parse motion definitions in ${file}`);
	}
	const constants = new Map();
	for (const statement of ast.statements) {
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					constants.set(declaration.name.text, declaration.initializer);
				}
			}
		}
	}
	function literal(node, visited = new Set()) {
		if (!node) { throw new Error(`Missing motion definition in ${file}`); }
		if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
			return literal(node.expression, visited);
		}
		if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
			return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
		}
		if (node.kind === ts.SyntaxKind.TrueKeyword) { return true; }
		if (node.kind === ts.SyntaxKind.FalseKeyword) { return false; }
		if (node.kind === ts.SyntaxKind.NullKeyword) { return null; }
		if (ts.isIdentifier(node)) {
			if (node.text === 'Infinity') { return Infinity; }
			if (visited.has(node.text)) { throw new Error(`Cyclic motion constant: ${node.text}`); }
			return literal(constants.get(node.text), new Set([...visited, node.text]));
		}
		if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
			const value = literal(node.operand, visited);
			if (typeof value === 'number') { return -value; }
		}
		if (ts.isArrayLiteralExpression(node)) {
			return node.elements.map(element => literal(element, visited));
		}
		if (ts.isObjectLiteralExpression(node)) {
			const value = Object.create(null);
			for (const property of node.properties) {
				if (ts.isSpreadAssignment(property)) {
					Object.assign(value, literal(property.expression, visited));
				} else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
					value[property.name.text] = literal(property.initializer, visited);
				} else {
					throw new Error(`Unsupported motion property in ${file}`);
				}
			}
			return value;
		}
		if (ts.isCallExpression(node) && node.expression.getText(ast) === 'localize') {
			return literal(node.arguments[1], visited);
		}
		const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
		throw new Error(`Unsupported motion expression at ${file}:${line}; update the source adapter`);
	}
	return { ast, constants, literal };
}

/** Project literal definitions without executing workspace code or importing stale build output. */
export function parseMotionDefinitions(ts, registryText, recipeText, source, responses = []) {
	const registry = motionModule(ts, registryText, motionDefinitionFiles[0]);
	const declaration = registry.constants.get('motionTokenRegistry');
	if (!declaration || !ts.isNewExpression(declaration) || declaration.expression.getText(registry.ast) !== 'MotionTokenRegistry') {
		throw new Error('The motion token declaration changed; update the source adapter');
	}
	const array = declaration.arguments?.[0];
	if (!array || !ts.isArrayLiteralExpression(array)) {
		throw new Error('Expected a literal motion token catalog');
	}
	const tokens = array.elements.map(element => ({ ...registry.literal(element), source: source(motionDefinitionFiles[0], element.getStart(registry.ast)) }));
	const recipes = recipeText === null ? [] : (() => {
		const recipes = motionModule(ts, recipeText, motionDefinitionFiles[1]);
		const declaration = recipes.constants.get('motionRecipes');
		return recipes.literal(declaration).map((recipe, index) => ({
			...recipe, source: source(motionDefinitionFiles[1], declaration.elements?.[index]?.getStart(recipes.ast) ?? declaration.getStart(recipes.ast)),
		}));
	})();
	return projectMotionDefinitions(tokens, recipes, responses);
}

export function readMotionData({ root, read }, file, names) {
	const ts = createRequire(path.join(root, 'package.json'))('typescript');
	const parsed = motionModule(ts, read(file), file);
	return Object.fromEntries(names.map(name => [name, parsed.literal(parsed.constants.get(name))]));
}

function readMotionResponses(ts, parametersText, generatedText, source) {
	let parameters;
	try { parameters = JSON.parse(parametersText); }
	catch { throw new Error(`Cannot parse Motion response parameters in ${motionResponseFiles[0]}`); }
	const generated = motionModule(ts, generatedText, motionResponseFiles[1]);
	const responsePresets = generated.literal(generated.constants.get('motionResponsePresets'));
	const digest = generated.literal(generated.constants.get('motionResponseSourceDigest'));
	const expectedDigest = `sha256:${createHash('sha256').update(parametersText).digest('hex')}`;
	if (digest !== expectedDigest) {
		throw new Error('Motion response exports are stale. Run node .github/skills/motion-design/scripts/generate-motion-responses.mjs.');
	}
	if (parameters?.schemaVersion !== 1 || !Array.isArray(parameters.presets) || !Array.isArray(responsePresets)) {
		throw new Error('Invalid Motion response source data.');
	}
	const inputs = new Map(parameters.presets.map(preset => [preset.id, preset]));
	const generatedIds = new Set();
	if (inputs.size !== parameters.presets.length || inputs.size !== responsePresets.length) {
		throw new Error('Motion response sources contain missing or duplicate presets.');
	}
	return responsePresets.map(response => {
		const input = inputs.get(response.id);
		const accuracy = parameters.accuracy;
		const provenance = parameters.source;
		if (!input || generatedIds.has(response.id) || response.label !== input.label || response.source?.preset !== input.sourcePreset
			|| response.frequencyHz !== input.frequencyHz || response.dampingRatio !== input.dampingRatio || response.mass !== input.mass
			|| !accuracy || response.limits?.maxEndpointResidual !== accuracy.maxEndpointResidual
			|| response.limits?.maxInterpolationError !== accuracy.maxInterpolationError || response.limits?.maxTravelPx !== accuracy.maxTravelPx
			|| !provenance || response.source?.repository !== provenance.repository || response.source?.revision !== provenance.revision
			|| response.source?.path !== provenance.path || response.source?.license !== provenance.license
			|| !Number.isFinite(response.durationMs) || response.durationMs <= 0 || typeof response.easing !== 'string' || !response.easing.startsWith('linear(')
			|| !response.metrics || !Number.isFinite(response.metrics.response50Ms) || !Number.isFinite(response.metrics.settle2PercentMs)
			|| !Number.isFinite(response.metrics.maxInterpolationError) || !response.limits || !Number.isFinite(response.limits.maxTravelPx)) {
			throw new Error(`Invalid generated Motion response: ${response.id}`);
		}
		generatedIds.add(response.id);
		return {
			id: response.id, label: response.label, sourcePreset: response.source.preset,
			frequencyHz: response.frequencyHz, dampingRatio: response.dampingRatio, mass: response.mass,
			durationMs: response.durationMs, easing: response.easing, limits: response.limits, metrics: response.metrics,
			provenance: response.source, source: source(motionResponseFiles[0], 0),
		};
	});
}

export function projectMotionDefinitions(tokens, recipes, responses = []) {
	const byId = new Map();
	const responsesById = new Map(responses.map(response => [response.id, response]));
	const cssNames = new Set();
	const cssName = id => `--vscode-${id.replaceAll('.', '-')}`;
	for (const token of tokens) {
		if (typeof token.id !== 'string' || byId.has(token.id) || cssNames.has(cssName(token.id))) {
			throw new Error(`Duplicate or invalid motion definition: ${token.id}`);
		}
		byId.set(token.id, token);
		cssNames.add(cssName(token.id));
	}
	function resolve(id, kind, visited = new Set()) {
		const token = byId.get(id);
		if (!token || kind && token.kind !== kind || visited.has(id)) {
			throw new Error(`Missing, incompatible, or cyclic motion reference: ${id}`);
		}
		if (token.value && typeof token.value === 'object' && 'ref' in token.value) {
			return resolve(token.value.ref, token.kind, new Set([...visited, id]));
		}
		if (token.value && typeof token.value === 'object' && 'response' in token.value) {
			const response = responsesById.get(token.value.response);
			if ((token.kind !== 'duration' && token.kind !== 'easing') || !response
				|| Object.keys(token.value).length !== 1) {
				throw new Error(`Missing, incompatible, or invalid Motion response reference: ${id}`);
			}
			return token.kind === 'duration' ? response.durationMs : response.easing;
		}
		return token.value;
	}
	function css(value, kind) {
		if (typeof value === 'number') {
			return value === Infinity ? 'infinite' : `${value}${['duration', 'delay'].includes(kind) ? 'ms' : kind === 'angle' ? 'deg' : ''}`;
		}
		if (typeof value === 'string') { return value; }
		if (Array.isArray(value)) { return `cubic-bezier(${value.join(', ')})`; }
		if (value && 'unit' in value) { return `${value.value}${value.unit}`; }
		if (value && 'steps' in value) { return `steps(${value.steps}${value.position ? `, ${value.position}` : ''})`; }
		throw new Error(`Unsupported ${kind} motion value`);
	}
	const projectedTokens = tokens.map(token => ({
		id: token.id, kind: token.kind, description: token.description, source: token.source, css: cssName(token.id),
		alias: token.value?.ref,
		category: motionTokenCategory(token),
		value: css(resolve(token.id), token.kind),
		...(typeof resolve(token.id) === 'number' && Number.isFinite(resolve(token.id)) ? { number: resolve(token.id) } : {}),
	}));
	const projectedRecipes = recipes.map(recipe => ({
		id: recipe.id, source: recipe.source, atom: recipe.atom, purpose: recipe.purpose, reduced: recipe.reduced, direction: recipe.direction,
		duration: resolve(recipe.duration, 'duration'), easing: css(resolve(recipe.easing, 'easing'), 'easing'),
		durationToken: recipe.duration, easingToken: recipe.easing,
		loop: recipe.iterations === Infinity,
		tracks: recipe.tracks?.map(track => ({
			property: track.property, duration: resolve(track.duration, 'duration'), easing: css(resolve(track.easing, 'easing'), 'easing'),
			durationToken: track.duration, easingToken: track.easing,
			...(track.delay ? { delay: resolve(track.delay, 'duration'), delayToken: track.delay } : {}),
		})) ?? [],
		properties: recipe.tracks?.map(track => track.property) ?? [],
		frameTokens: recipe.frames,
		frames: recipe.frames.map(frame => ({
			...(frame.opacity !== undefined ? { opacity: typeof frame.opacity === 'number' ? frame.opacity : resolve(frame.opacity, 'opacity') } : {}),
			...(frame.scale !== undefined ? { scale: typeof frame.scale === 'number' ? frame.scale : resolve(frame.scale, 'scale') } : {}),
			...(frame.angle !== undefined ? { angle: typeof frame.angle === 'number' ? frame.angle : resolve(frame.angle, 'angle') } : {}),
			...(frame.distance !== undefined ? { distance: typeof frame.distance === 'string' ? resolve(frame.distance, 'distance') : frame.distance } : {}),
			...(frame.offset !== undefined ? { offset: frame.offset } : {}),
		})),
	}));
	const easingIds = [...new Set([
		...projectedRecipes.flatMap(recipe => [recipe.easingToken, ...recipe.tracks.map(track => track.easingToken)]),
		...projectedTokens.filter(token => token.id.startsWith('motion.easing.')).map(token => token.id),
		'motion.disclosure.easing', 'motion.matrix.easing',
	])];
	return {
		status: recipes.length ? 'defined' : 'partial', tokens: projectedTokens, recipes: projectedRecipes, responses,
		durations: projectedTokens.filter(token => token.kind === 'duration' && token.category === 'ramp').sort((a, b) => a.number - b.number),
		easings: easingIds.filter(id => byId.has(id)).map(id => {
			const value = resolve(id, 'easing');
			return {
				id, description: byId.get(id).description, value: css(value, 'easing'),
				...(value && typeof value === 'object' && 'steps' in value ? { steps: value.steps } : {}),
				curve: Array.isArray(value) ? value : typeof value === 'string'
					? ({ ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], linear: [0, 0, 1, 1] }[value] ?? null) : null,
			};
		}),
	};
}

export function readMotionDefinitions({ root, read, source }) {
	const definitionTexts = motionDefinitionFiles.map(file => {
		try { return read(file); }
		catch (error) { if (error.code === 'ENOENT') { return null; } throw error; }
	});
	if (definitionTexts[0] === null) {
		if (definitionTexts[1] !== null) { throw new Error('Motion recipes exist without their token catalog'); }
		return { status: 'absent', tokens: [], recipes: [], responses: [], durations: [], easings: [], scope: motionSourceFiles };
	}
	const require = createRequire(path.join(root, 'package.json'));
	let ts;
	try { ts = require('typescript'); }
	catch (error) {
		if (error.code !== 'MODULE_NOT_FOUND') { throw error; }
		throw new Error('Reading typed motion definitions needs this checkout’s TypeScript dependency; restore its repository dependencies');
	}
	const registry = motionModule(ts, definitionTexts[0], motionDefinitionFiles[0]);
	const declaration = registry.constants.get('motionTokenRegistry');
	if (!declaration || !ts.isNewExpression(declaration) || declaration.expression.getText(registry.ast) !== 'MotionTokenRegistry'
		|| !declaration.arguments?.[0] || !ts.isArrayLiteralExpression(declaration.arguments[0])) {
		throw new Error('The motion token declaration changed; update the source adapter');
	}
	const needsResponses = registry.literal(declaration.arguments[0]).some(token =>
		token.value && typeof token.value === 'object' && 'response' in token.value);
	const responseTexts = motionResponseFiles.map(file => {
		try { return read(file); }
		catch (error) { if (error.code === 'ENOENT') { return null; } throw error; }
	});
	let responses = [];
	if (responseTexts.some(text => text !== null)) {
		if (responseTexts.some(text => text === null)) { throw new Error('Motion response sources are incomplete.'); }
		responses = readMotionResponses(ts, responseTexts[0], responseTexts[1], source);
	} else if (needsResponses) {
		throw new Error('Motion response sources are required by the token registry.');
	}
	return {
		...parseMotionDefinitions(ts, definitionTexts[0], definitionTexts[1], source, responses),
		scope: motionSourceFiles,
		sources: motionSourceFiles.filter((_file, index) => (index < definitionTexts.length ? definitionTexts[index] : responseTexts[index - definitionTexts.length]) !== null),
	};
}

/** Resolve the Motion page's heading references without executing authored content. */
export function readMotionPage(context, definitions, presetBindingIds) {
	const page = resolveContent(JSON.parse(context.read(motionPageFile)), context.read);
	if (page.version !== 1 || page.id !== 'motion' || page.renderer !== 'motion' || page.source !== motionGuidanceFile) {
		throw new Error(`Unsupported Motion page descriptor: ${motionPageFile}`);
	}
	const text = context.read(motionGuidanceFile);
	const headings = [];
	let fence;
	let offset = 0;
	for (const line of text.split('\n')) {
		const delimiter = line.match(/^\s*(?<fence>`{3,}|~{3,})/);
		if (delimiter) {
			const marker = delimiter.groups.fence;
			if (!fence) { fence = marker; }
			else if (marker[0] === fence[0] && marker.length >= fence.length) { fence = undefined; }
		} else if (!fence) {
			const heading = line.match(/^(?<marks>#{1,6})\s+(?<title>.+?)\s*#*\s*$/);
			if (heading) {
				const title = heading.groups.title;
				const id = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
				if (headings.some(heading => heading.id === id)) { throw new Error(`Ambiguous Motion heading: ${id}`); }
				headings.push({ id, title, level: heading.groups.marks.length, offset, start: offset + line.length + 1 });
			}
		}
		offset += line.length + 1;
	}
	if (fence) { throw new Error('Unclosed fence in Motion guidance'); }
	const sections = Object.create(null);
	for (const [index, heading] of headings.entries()) {
		sections[heading.id] = {
			title: heading.title, level: heading.level,
			markdown: text.slice(heading.start, headings[index + 1]?.offset ?? text.length).replace(/\r\n/g, '\n').trim(),
			source: context.source(motionGuidanceFile, heading.offset),
		};
	}
	const requireHeading = id => {
		if (typeof id !== 'string' || !sections[id]) { throw new Error(`Missing Motion heading: ${id}`); }
	};
	const ids = name => {
		if (!Array.isArray(page[name]) || !page[name].length) { throw new Error(`Missing Motion collection: ${name}`); }
		const entries = page[name].map(entry => entry.id);
		if (entries.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) || new Set(entries).size !== entries.length) {
			throw new Error(`Invalid or duplicate Motion ${name} identity`);
		}
		return new Set(entries);
	};
	const tokens = new Set(definitions.tokens.map(token => token.id));
	const requireId = (set, id, kind) => {
		if (!set.has(id)) { throw new Error(`Missing Motion ${kind}: ${id}`); }
	};
	const examples = ids('examples');
	const recipes = ids('recipes');
	if (presetBindingIds !== undefined) {
		const presetBindings = new Set(presetBindingIds);
		for (const example of page.examples) {
			if (example.presetBindingId) { requireId(presetBindings, example.presetBindingId, 'preset binding'); }
		}
	}
	if (page.analyses) {
		ids('analyses');
		const analyzedExamples = new Set();
		for (const analysis of page.analyses) {
			if (analyzedExamples.has(analysis.exampleId)) { throw new Error(`Duplicate Motion analysis example: ${analysis.exampleId}`); }
			analyzedExamples.add(analysis.exampleId);
		}
	}
	const productRecipes = new Set(definitions.recipes.map(recipe => recipe.id));
	ids('sections');
	ids('properties');
	if (page.responses) {
		ids('responses');
		if (definitions.status === 'defined') {
			const responses = new Set(definitions.responses.map(response => response.id));
			for (const response of page.responses) { requireId(responses, response.id, 'response'); }
		}
	}
	const durations = page.durations ? ids('durations') : new Set();
	for (const duration of page.durations ?? []) {
		if (!duration.title || !duration.description || duration.tokens?.length !== 1 || duration.exampleId) {
			throw new Error('Motion duration studies need a title, guidance, and one duration token, not a product example');
		}
		if (definitions.status === 'defined' && !definitions.tokens.some(token => token.id === duration.tokens[0] && token.kind === 'duration')) {
			throw new Error(`Missing Motion duration token: ${duration.tokens[0]}`);
		}
	}
	const inspect = value => {
		if (!value || typeof value !== 'object') { return; }
		for (const key of ['title', 'description', 'intro', 'caption']) {
			if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim())) {
				throw new Error(`Invalid Motion ${key}`);
			}
		}
		if (value.heading) { requireHeading(value.heading); }
		if (value.reference) { requireHeading(value.reference); }
		for (const heading of value.headings ?? []) { requireHeading(heading); }
		for (const token of value.tokens ?? []) {
			if (definitions.status === 'defined') { requireId(tokens, token, 'token'); }
		}
		if (value.type && !['guidance', 'group', 'duration', 'easing', 'responses', 'reference', 'properties', 'transitions', 'recipe', 'examples', 'example'].includes(value.type)) {
			throw new Error(`Unsupported Motion block: ${value.type}`);
		}
		if (['reference', 'group'].includes(value.type) && value.blocks !== undefined && !Array.isArray(value.blocks)) {
			throw new Error('Invalid Motion reference content');
		}
		if (value.type === 'duration' && (!durations.size || !page.durationIntro)) { throw new Error('Missing Motion duration comparisons'); }
		if (value.type === 'responses' && !page.responses?.length) { throw new Error('Missing Motion response specimens'); }
		if (value.type === 'example') { requireId(examples, value.id, 'example'); }
		if (value.type === 'recipe') { requireId(recipes, value.id, 'recipe'); }
		if (value.example) { requireId(examples, value.example, 'example'); }
		if (value.exampleId) { requireId(examples, value.exampleId, 'analysis example'); }
		if (value.recipeId && definitions.status === 'defined') { requireId(productRecipes, value.recipeId, 'analysis recipe'); }
		if (value.recipe) { requireId(recipes, value.recipe, 'recipe'); }
		for (const [key, child] of Object.entries(value)) {
			if (['examples', 'recipes'].includes(key) && Array.isArray(child) && child.some(item => typeof item === 'string')) {
				for (const id of child) { requireId(key === 'examples' ? examples : recipes, id, key); }
			} else if (Array.isArray(child)) {
				child.forEach(inspect);
			} else { inspect(child); }
		}
	};
	inspect(page);
	if (!Array.isArray(page.easings) || !page.easings.length) { throw new Error('Missing Motion easing comparisons'); }
	for (const easing of page.easings) {
		if (!Array.isArray(easing.variants) || !easing.variants.length) { throw new Error(`Missing Motion curve variants: ${easing.heading}`); }
		for (const [id] of easing.variants) {
			if (definitions.status === 'defined') { requireId(tokens, id, 'curve'); }
		}
	}
	for (const recipe of page.recipes) {
		const snippets = [...sections[recipe.reference].markdown.matchAll(/^```css\n(?<code>[\s\S]*?)\n```/gm)];
		if (snippets.length !== 1) {
			throw new Error(`Expected one CSS example in Motion heading: ${recipe.reference}`);
		}
		if (definitions.status === 'defined') {
			const variables = new Set([
				...definitions.tokens.map(token => token.css),
				...definitions.recipes.filter(recipe => recipe.tracks.length).map(recipe => `--vscode-${recipe.id.replaceAll('.', '-')}-transition`),
			]);
			for (const reference of snippets[0].groups.code.matchAll(/var\((?<name>--[\w-]+)/g)) {
				requireId(variables, reference.groups.name, 'CSS variable');
			}
		}
	}
	requireHeading('motion');
	return { page, sections, intro: page.intro ?? sections.motion.markdown };
}
