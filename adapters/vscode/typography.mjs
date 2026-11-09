/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

export function readSizeTokens(text, file) {
	const constants = new Map([...text.matchAll(/\bconst\s+(?<name>\w+)\s*=\s*(?<value>\d+)\s*;/g)].map(match => [match.groups.name, match.groups.value]));
	const tokens = [...text.matchAll(/registerSize\(\s*'(?<id>[^']+)',\s*sizeForAllThemes\((?<value>\w+), '(?<unit>[^']*)'\),\s*(?:nls\.)?localize\('[^']+', "(?<description>[^"]*)"\)(?<rest>[\s\S]*?)\);/g)];
	return tokens.map(match => {
		const { id, value, unit, description, rest } = match.groups;
		const resolved = /^\d+$/.test(value) ? value : constants.get(value);
		if (resolved === undefined) { throw new Error(`Unrecognized size value: ${file}, ${id}, ${value}`); }
		const replacement = rest.match(/Deprecated: use `(?<id>[^`]+)` instead/);
		return {
			id, value: `${resolved}${unit}`, css: `--vscode-${id.replaceAll('.', '-')}`, description,
			category: /font|Font/.test(id) ? 'typography' : id.startsWith('spacing') ? 'spacing' : id.startsWith('agents.layout.') ? 'layout' : 'shape',
			deprecated: Boolean(replacement),
			...(replacement ? { replacement: replacement.groups.id } : {}),
			source: { file, line: text.slice(0, match.index + match[0].indexOf(`'${id}'`)).split('\n').length },
		};
	});
}

export function readTypography(read, baseTokens) {
	const agentsFile = 'src/vs/workbench/common/agentsSizes.ts';
	const agentsText = read(agentsFile);
	const agentsTokens = readSizeTokens(agentsText, agentsFile).filter(token => token.category === 'typography');
	const expectedAgents = [...agentsText.matchAll(/registerSize\(\s*'agents\.font(?:Size|Weight)\.[^']+'/g)].length;
	if (agentsTokens.length !== expectedAgents) {
		throw new Error('Some Agents typography registrations were not recognized. Update the source adapter.');
	}
	const tokens = [...baseTokens.filter(token => token.category === 'typography'), ...agentsTokens];
	const cssFile = 'src/vs/workbench/browser/media/style.css';
	const css = read(cssFile);
	const families = [...css.matchAll(/\.monaco-workbench\.(?<platform>mac|windows|linux)(?::lang\((?<locale>[^)]+)\))?\s*\{\s*(?<property>font-family|--monaco-monospace-font):\s*(?<value>[^;]+);/g)].map(match => ({
		...match.groups, locale: match.groups.locale ?? 'Default',
		source: { file: cssFile, line: css.slice(0, match.index).split('\n').length },
	}));
	const baseline = css.match(/\.monaco-workbench\s*\{\s*font-size:\s*(?<size>[^;]+);\s*line-height:\s*(?<height>[^;]+);/);
	if (!baseline || families.filter(family => family.locale === 'Default').length !== 6) {
		throw new Error('Workbench typography styles changed. Update the source adapter.');
	}
	const editorFile = 'src/vs/editor/common/config/fontInfo.ts';
	const editorText = read(editorFile);
	const editorLine = editorText.split('\n').findIndex(line => line.includes('GOLDEN_LINE_HEIGHT_RATIO ='));
	if (editorLine < 0) {
		throw new Error('Editor typography context changed. Update the source adapter.');
	}
	return {
		tokens,
		families,
		baseline: { fontSize: baseline.groups.size, lineHeight: baseline.groups.height, source: { file: cssFile, line: css.slice(0, baseline.index).split('\n').length } },
		editorSource: { file: editorFile, line: editorLine + 1 },
		references: [
			{ title: 'Fluent 2 typography', url: 'https://fluent2.microsoft.design/typography' },
			{ title: 'Carbon typography', url: 'https://carbondesignsystem.com/elements/typography/overview/' },
		],
		gaps: 'Font families and the workbench line-height are source styles, not registered size tokens. Shared line-height, tracking, and control-specific type recipes are not defined by the base token registry.',
	};
}
