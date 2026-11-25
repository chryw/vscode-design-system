/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
import { createColorResolver, readColorDefinitionFiles } from '../color-catalog.mjs';

export function load({read,source,root}, palettes = []){
	const elevationFile = '.github/skills/design-system/foundations/elevation.design.md';
	const elevationText = read(elevationFile);
	const tierStart = elevationText.indexOf('## Surface hierarchy');
	const tierEnd = elevationText.indexOf('\n## What makes elevation', tierStart);
	if (tierStart === -1 || tierEnd === -1) {
		throw new Error('Elevation guidance changed. Update the source adapter.');
	}
	const shadowFile = 'src/vs/platform/theme/common/colors/editorColors.ts';
	const shadowText = read(shadowFile);
	const shadowStart = shadowText.indexOf('export const widgetShadow = registerColor(\'widget.shadow\'');
	const shadowEnd = shadowText.indexOf('// ----- toolbar', shadowStart);
	if (shadowStart === -1 || shadowEnd === -1) {
		throw new Error('Widget shadow registrations changed. Update the source adapter.');
	}
	const shadowRegistrations = [...shadowText.slice(shadowStart, shadowEnd).matchAll(/registerColor\('(?<id>widget\.(?:shadow|border))',\s*\n\s*(?<defaults>\{[^\n]+\})/g)]
		.map(match => ({ ...match.groups, source: source(shadowFile, shadowStart + match.index) }));
	if (shadowRegistrations.length !== 2) {
		throw new Error('Widget shadow defaults changed. Update the source adapter.');
	}
	const elevation = {
		tiers: { text: elevationText.slice(tierStart, tierEnd), source: source(elevationFile, tierStart) },
		shadows: { text: shadowText.slice(shadowStart, shadowEnd).trim(), source: source(shadowFile, shadowStart), registrations: shadowRegistrations },
		cssShadows: [...read('src/vs/workbench/browser/media/style.css').matchAll(/^[ \t]*(?<css>--vscode-shadow-(?:sm|md|lg|xl)):\s*(?<value>[^;]+);/gm)]
			.filter(match => !match.groups.value.includes('transparent'))
			.map(match => ({ ...match.groups, source: source('src/vs/workbench/browser/media/style.css', match.index) })),
		shadowUsage: [...read('src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css').matchAll(/box-shadow:\s*(?<value>[^;]+);/g)]
			.map(match => ({ value: match.groups.value, source: source('src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css', match.index) })),
	};
	if (palettes.length) {
		const files = ['baseColors', 'editorColors', 'quickpickColors', 'semanticColors']
			.map(name => `src/vs/platform/theme/common/colors/${name}.ts`);
		files.push('src/vs/workbench/common/theme.ts');
		const definitions = readColorDefinitionFiles(files, read, root);
		const byId = new Map(definitions.map(definition => [definition.id, definition]));
		const symbols = new Map(definitions.filter(definition => definition.symbol).map(definition => [definition.symbol, definition.id]));
		const ids = [
			'editor.background', 'editor.foreground', 'sideBar.background', 'sideBar.foreground', 'panel.background', 'panel.border',
			'editorHoverWidget.background', 'editorHoverWidget.foreground', 'editorHoverWidget.border',
			'editorWidget.background', 'editorWidget.foreground', 'editorWidget.border',
			'quickInput.background', 'quickInput.foreground', 'contrastBorder', 'focusBorder',
		];
		elevation.palettes = palettes.map(({ theme, colors, label }) => {
			const resolve = createColorResolver(byId, symbols, colors, [], theme);
			return {
				id: theme.id, label, highContrast: theme.type.startsWith('hc-'),
				tokens: ids.map(id => {
					const color = resolve(id);
					if (color.value === 'Runtime-only') { throw new Error(`Cannot resolve elevation preview color: ${id}`); }
					return { id, css: `--vscode-${id.replaceAll('.', '-')}`, value: color.value === 'Unset' ? 'transparent' : color.value };
				}),
			};
		});
	}
return {elevation};
}
