/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { colorDefinitions, createColorResolver } from '../color-catalog.mjs';
import { readMotionDefinitions } from './motion-source.mjs';
import { readSizeTokens } from '../typography.mjs';
import { readContent } from './authored.mjs';

export function load(context, theme, declarations) {
	const { read, source } = context;
	read('.github/design-system/foundations.md');
	const tokenGuidance = readContent(read, 'content/foundations/token-domains.json').domains.map(domain => {
		const text = read(domain.file);
		const offset = text.indexOf(domain.anchor);
		if (offset < 0) { throw new Error(`Token guidance changed: ${domain.title}`); }
		return { ...domain, source: source(domain.file, offset) };
	});
	const file = 'src/vs/platform/theme/common/colors/semanticColors.ts';
	const definitions = colorDefinitions(read(file), file, context.root);
	if (!definitions.length || definitions.some(definition => !definition.id?.startsWith('color.'))) {
		throw new Error('Shared color-role definitions changed');
	}
	const resolve = createColorResolver(new Map(definitions.map(definition => [definition.id, definition])),
		new Map(definitions.filter(definition => definition.symbol).map(definition => [definition.symbol, definition.id])),
		declarations, [], theme);
	const designTokens = definitions.map(definition => ({
		id: definition.id, css: `--vscode-${definition.id.replaceAll('.', '-')}`, group: 'colors',
		...resolve(definition.id), purpose: definition.description, scope: theme.id, source: definition.definitionSource,
	}));
	const motion = readMotionDefinitions(context);
	designTokens.push(...motion.tokens.map(token => ({
		...token, group: 'motion', purpose: token.description, scope: token.kind,
	})));
	designTokens.push(...motion.recipes.filter(recipe => recipe.tracks.length).map(recipe => ({
		id: `${recipe.id}.transition`, css: `--vscode-${recipe.id.replaceAll('.', '-')}-transition`,
		value: recipe.tracks.map(track => `${track.property} var(--vscode-${track.durationToken.replaceAll('.', '-')}) var(--vscode-${track.easingToken.replaceAll('.', '-')})${track.delayToken ? ` var(--vscode-${track.delayToken.replaceAll('.', '-')})` : ''}`).join(', '),
		group: 'motion', purpose: recipe.purpose, scope: 'CSS transition style', source: recipe.source,
	})));
	const agentsFile = 'src/vs/workbench/common/agentsSizes.ts';
	const agentsText = read(agentsFile);
	const agentSizes = readSizeTokens(agentsText, agentsFile);
	if (agentSizes.length !== [...agentsText.matchAll(/\bregisterSize\(/g)].length) { throw new Error('Unrecognized Agents size registration'); }
	designTokens.push(...agentSizes.filter(token => token.id.startsWith('agents.layout.')).map(token => ({
		...token, group: 'layout', purpose: token.description, scope: 'Agents window',
	})));
	return { designTokens, tokenGuidance };
}
