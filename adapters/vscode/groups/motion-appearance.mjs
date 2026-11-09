/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- The canvas reads product styles without a build. */
import { colorDefinitions, createColorResolver } from '../color-catalog.mjs';

export function load({ read, root }, darkTheme, darkColors, lightTheme, lightColors) {
	const fixtures = read('src/vs/workbench/test/browser/componentFixtures/fixtureUtils.ts');
	for (const [name, theme] of [['darkTheme', darkTheme], ['lightTheme', lightTheme]]) {
		const match = fixtures.match(new RegExp(`export const ${name} = createBuiltInTheme\\('(?<file>[^']+)'`));
		if (match?.groups.file !== `/${theme.file}`) { throw new Error(`The fixture ${name} changed; update the motion palette mapping`); }
	}
	const files = ['baseColors', 'editorColors', 'inputColors', 'semanticColors'];
	const definitions = files.flatMap(name => {
		const file = `src/vs/platform/theme/common/colors/${name}.ts`;
		return colorDefinitions(read(file), file, root);
	});
	const byId = new Map(definitions.map(definition => [definition.id, definition]));
	const symbols = new Map(definitions.filter(definition => definition.symbol).map(definition => [definition.symbol, definition.id]));
	const ids = [
		'editor.background', 'editor.foreground', 'editorWidget.background', 'editorWidget.border',
		'focusBorder', 'descriptionForeground', 'input.background', 'input.border', 'widget.shadow',
		'inputOption.activeBackground', 'inputOption.activeBorder', 'inputOption.activeForeground',
		'button.background', 'button.foreground', 'button.hoverBackground', 'button.border',
		'button.secondaryBackground', 'button.secondaryForeground', 'button.secondaryHoverBackground', 'button.secondaryBorder',
	];
	const palette = (theme, colors) => {
		const resolve = createColorResolver(byId, symbols, colors, [], theme);
		return ids.map(id => {
			const color = resolve(id);
			if (color.value === 'Runtime-only') { throw new Error(`Cannot resolve motion preview color: ${id}`); }
			return { id, css: `--vscode-${id.replaceAll('.', '-')}`, value: color.value === 'Unset' ? 'transparent' : color.value };
		});
	};
	return {
		motionAppearance: {
			themes: { dark: darkTheme.id, light: lightTheme.id },
			dark: palette(darkTheme, darkColors),
			light: palette(lightTheme, lightColors),
			buttonCss: read('src/vs/base/browser/ui/button/button.css'),
		},
	};
}
