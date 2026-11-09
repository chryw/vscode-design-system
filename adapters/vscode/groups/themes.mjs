/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import {globSync} from 'node:fs';
import path from 'node:path';
import {parseJsonc} from '../jsonc.mjs';
import {createThemePaletteReader} from '../theme-palettes.mjs';
import {readAnsiColors,ansiRegistryFile} from '../ansi-colors.mjs';
const cssName = id => `--vscode-${id.replaceAll('.', '-')}`;
export function load({root,read,source,repository},selectedTheme='Dark 2026',comparisonTheme='Light 2026',includeRegistry=false,includeGallery=true){
	const corePaletteThemes = repository.corePaletteThemes;
	const themeManifests = globSync('extensions/theme-*/package.json', { cwd: root }).sort().map(file => file.split(path.sep).join('/'));
	const themeRoots = themeManifests.map(file => `${path.posix.dirname(file)}/`);
	const themes = themeManifests.flatMap(file => {
		const manifest = JSON.parse(read(file));
		return (manifest.contributes?.themes ?? []).map(theme => ({
			id: theme.id, type: theme.uiTheme,
			file: path.posix.normalize(path.posix.join(path.posix.dirname(file), theme.path)),
		}));
	});
	const selected = themes.find(theme => theme.id === selectedTheme);
	if (!selected) {
		throw new Error(`Unknown theme: ${selectedTheme}`);
	}
	const chain = [];
	const loadTheme = (file, visited = new Set(), inheritance = []) => {
		if (!themeRoots.some(root => file.startsWith(root)) || !file.endsWith('.json')) {
			throw new Error('Theme include must stay in a built-in theme extension');
		}
		if (visited.has(file)) {
			throw new Error(`Theme include cycle: ${file}`);
		}
		visited.add(file);
		const text = read(file);
		const theme = parseJsonc(text);
		if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
			throw new Error(`Invalid theme document: ${file}`);
		}
		const colors = theme.include ? loadTheme(path.posix.normalize(path.posix.join(path.posix.dirname(file), theme.include)), visited, inheritance) : new Map();
		inheritance.push(file);
		for (const [id, value] of Object.entries(theme.colors ?? {})) {
			if (value === null) {
				colors.delete(id);
				continue;
			}
			if (!/^[\w.-]+$/.test(id) || typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
				throw new Error(`Unsupported theme color ${id} in ${file}`);
			}
			const offset = text.indexOf(JSON.stringify(id));
			colors.set(id, { id, value, css: cssName(id), category: 'colors', source: source(file, offset) });
		}
		return colors;
	};
	const declarations = [...loadTheme(selected.file, new Set(), chain).values()].sort((a, b) => a.id.localeCompare(b.id));
	const ansiColors = readAnsiColors(read(ansiRegistryFile), selected, declarations);
	const colors = [...declarations.filter(token => !ansiColors.some(ansi => ansi.id === token.id)), ...ansiColors]
		.sort((a, b) => a.id.localeCompare(b.id));
	const compared = themes.find(theme => theme.id === comparisonTheme);
	if (!compared) {
		throw new Error(`Unknown comparison theme: ${comparisonTheme}`);
	}
	const comparisonChain = [];
	const comparisonColors = [...loadTheme(compared.file, new Set(), comparisonChain).values()].sort((a, b) => a.id.localeCompare(b.id));
	const palette = createThemePaletteReader(read);
	read('src/vs/workbench/common/agentsColors.ts');
	const themeGallery = includeGallery ? themes.map(theme => ({ ...theme, palette: palette(theme, loadTheme(theme.file)) })) : [];
	const result = {themes,themeGallery,theme:selected,chain,colors,comparison:{theme:compared,chain:comparisonChain,colors:comparisonColors}};
	if (!includeRegistry) { return result; }
	return import('../color-catalog.mjs').then(({ readColorCatalog }) => {
		const palettes = corePaletteThemes.map(({ id, label }) => {
			const theme = themes.find(theme => theme.id === id);
			if (!theme) { throw new Error(`Missing color reference theme: ${id}`); }
			const declarations = [...loadTheme(theme.file).values()];
			return { theme, label, declarations, ansi: readAnsiColors(read(ansiRegistryFile), theme, declarations) };
		});
		const registry = readColorCatalog(root, read, declarations, ansiColors, selected, palettes);
		return { ...result, colorCatalog: registry.colors, colorPalettes: registry.palettes, colorRegistryCoverage: registry.coverage };
	});
}
