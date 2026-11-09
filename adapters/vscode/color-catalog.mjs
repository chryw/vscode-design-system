/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { workspaceRoot } from '../../runtime/paths.mjs';
import { ansiRegistryFile } from './ansi-colors.mjs';

const parsedFiles = new Map();

export function colorDefinitions(text, file, root = workspaceRoot) {
	const key = `${root}\0${file}`;
	const cached = parsedFiles.get(key);
	if (cached?.text === text) {
		return cached.definitions;
	}
	const require = createRequire(path.join(root, 'package.json'));
	let ts;
	try { ts = require('typescript'); }
	catch (error) { throw new Error(`Color parsing needs the selected checkout's TypeScript dependency. Restore its dependencies: ${error.message}`); }
	const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	if (ast.parseDiagnostics.length) {
		throw new Error(`Color registration source has syntax problems: ${file}`);
	}
	const strings = new Map();
	const definitions = [];
	const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
	const collect = node => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && literal(node.initializer)) {
			strings.set(node.name.text, literal(node.initializer));
		}
		ts.forEachChild(node, collect);
	};
	collect(ast);
	const visit = node => {
		if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerColor') {
			const argument = node.arguments[0];
			const id = literal(argument) ?? (argument && ts.isIdentifier(argument) ? strings.get(argument.text) : undefined);
			if (id) {
				const description = node.arguments[2];
				definitions.push({
					id, defaults: node.arguments[1]?.getText(ast) ?? '',
					description: literal(description) ?? (description && ts.isCallExpression(description) ? literal(description.arguments[1]) : undefined),
					schemes: node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1]) ? Object.fromEntries(node.arguments[1].properties.filter(ts.isPropertyAssignment).map(property => [
						ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(ast), property.initializer.getText(ast),
					])) : undefined,
					symbol: ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined,
					definitionSource: { file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 },
				});
			} else {
				definitions.push({ id: null, argument: argument?.getText(ast), definitionSource: { file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 } });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	parsedFiles.set(key, { text, definitions });
	return definitions;
}

export function createColorResolver(definitions, symbols, declarations, ansi, theme) {
	const values = new Map([...declarations, ...ansi].map(color => [color.id, color]));
	const scheme = { 'vs': 'light', 'vs-dark': 'dark', 'hc-black': 'hcDark', 'hc-light': 'hcLight' }[theme.type];
	const constants = new Map([['Color.black', '#000000'], ['Color.white', '#FFFFFF'], ['Color.transparent', '#00000000']]);
	const resolve = (id, visited = new Set()) => {
		if (values.has(id)) {
			const color = values.get(id);
			return { value: color.value, resolution: color.origin === 'default' ? 'registered default' : 'theme declaration', declarationSource: color.source };
		}
		if (visited.has(id)) {
			return { value: 'Runtime-only', resolution: 'cyclic default reference' };
		}
		visited.add(id);
		const definition = definitions.get(id);
		let expression = definition?.defaults ?? '';
		if (definition?.schemes) {
			const value = definition.schemes[scheme] ?? (scheme.startsWith('hc') ? definition.schemes.highContrast : undefined);
			if (value === undefined) {
				return { value: 'Unset', resolution: 'no default for this theme type' };
			}
			expression = value.trim();
		}
		const literal = expression.match(/^['"]([^'"]+)['"]$/)?.[1];
		if (literal && /^#[\da-f]{3,8}$/i.test(literal)) {
			return { value: literal, resolution: 'registered default' };
		}
		if (constants.has(expression)) {
			return { value: constants.get(expression), resolution: 'registered default' };
		}
		if (expression === 'null' || expression === 'undefined') {
			return { value: 'Unset', resolution: 'explicitly unset default' };
		}
		const opacity = expression.match(/^transparent\((?<symbol>\w+(?:\.\w+)?),\s*(?<factor>(?:\d+(?:\.\d*)?|\.\d+))\)$/);
		if (opacity && (constants.has(opacity.groups.symbol) || symbols.has(opacity.groups.symbol)) && Number(opacity.groups.factor) <= 1) {
			const color = constants.has(opacity.groups.symbol) ? { value: constants.get(opacity.groups.symbol), resolution: 'registered default' } : resolve(symbols.get(opacity.groups.symbol), visited);
			return ['Unset', 'Runtime-only'].includes(color.value) ? color : {
				...color,
				value: `color-mix(in srgb, ${color.value} ${Number(opacity.groups.factor) * 100}%, transparent)`,
				resolution: `transparent default; ${color.resolution}`,
			};
		}
		const alias = literal ?? symbols.get(expression);
		if (alias && definitions.has(alias)) {
			const resolved = resolve(alias, visited);
			return { ...resolved, resolution: `default reference ${alias}; ${resolved.resolution}`, defaultAlias: alias };
		}
		return { value: 'Runtime-only', resolution: 'computed default not resolved by this reader' };
	};
	return resolve;
}

export function readColorCatalog(root, read, declarations, ansi, theme, palettes = []) {
	const files = execFileSync('git', ['grep', '--untracked', '-l', '-E', 'registerColor\\(', '--', 'src/vs/**/*.ts'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => !file.includes('/test/')).sort();
	const definitions = new Map();
	const symbols = new Map();
	const unresolvedCalls = [];
	const sourceAt = (file, text, index) => ({ file, line: text.slice(0, index).split('\n').length });
	for (const file of files) {
		const text = read(file);
		for (const definition of colorDefinitions(text, file, root)) {
			if (!definition.id) {
				unresolvedCalls.push(definition);
				continue;
			}
			if (definition.symbol) {
				const previous = symbols.get(definition.symbol);
				symbols.set(definition.symbol, symbols.has(definition.symbol) && previous !== definition.id ? null : definition.id);
			}
			definitions.set(definition.id, definition);
		}
	}
	for (const file of globSync('extensions/*/package.json', { cwd: root }).sort()) {
		const text = read(file);
		for (const color of JSON.parse(text).contributes?.colors ?? []) {
			definitions.set(color.id, {
				id: color.id, defaults: JSON.stringify(color.defaults), schemes: color.defaults ? Object.fromEntries(Object.entries(color.defaults).map(([key, value]) => [key, typeof value === 'string' ? JSON.stringify(value) : String(value)])) : undefined,
				description: color.description,
				definitionSource: sourceAt(file, text, text.indexOf(`"${color.id}"`)),
			});
		}
	}
	for (const color of ansi) {
		if (!definitions.has(color.id)) {
			const registration = unresolvedCalls.find(call => call.definitionSource.file === ansiRegistryFile && call.argument === 'id');
			if (!registration) {
				throw new Error('ANSI registration loop is not recognized; do not substitute a theme-value source');
			}
			definitions.set(color.id, { id: color.id, defaults: '', definitionSource: registration.definitionSource });
		}
	}
	const resolvePalette = (declarations, ansi, theme) => createColorResolver(definitions, symbols, declarations, ansi, theme);
	const resolve = resolvePalette(declarations, ansi, theme);
	const comparisons = palettes.map(palette => ({ ...palette, resolve: resolvePalette(palette.declarations, palette.ansi, palette.theme) }));
	const colors = [...definitions.values()].map(definition => ({
		id: definition.id, css: `--vscode-${definition.id.replaceAll('.', '-')}`, category: 'colors',
		description: definition.description,
		...resolve(definition.id), source: definition.definitionSource, definitionSource: definition.definitionSource,
		values: Object.fromEntries(comparisons.map(palette => [palette.theme.id, palette.resolve(definition.id)])),
	})).sort((a, b) => a.id.localeCompare(b.id));
	const inventoryFile = 'build/lib/stylelint/vscode-known-variables.json';
	const expected = JSON.parse(read(inventoryFile)).colors;
	const found = new Set(colors.map(color => color.css));
	return {
		colors,
		palettes: comparisons.map(({ theme, label }) => ({ id: theme.id, label, type: theme.type, file: theme.file })),
		coverage: {
			definitions: colors.length, ansi: ansi.length, definitionFiles: files,
			inventoryFile, inventoryEntries: expected.length,
			unmatchedInventory: expected.filter(css => !found.has(css)),
			additionalDefinitions: colors.filter(color => !expected.includes(color.css)).map(color => color.id),
			dynamicRegistrationCalls: unresolvedCalls,
			scope: 'Current registerColor definitions and built-in extension color contributions; computed/unset defaults remain explicit. Runtime-maintained inventory cross-check is not silently treated as a definition.',
		},
	};
}
