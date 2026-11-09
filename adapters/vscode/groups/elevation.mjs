/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */
export function load({read,source}){
	const elevationGuidance = {file:'.github/skills/design-philosophy/SKILL.md',text:read('.github/skills/design-philosophy/SKILL.md')};
	const tierStart = elevationGuidance.text.indexOf('### Elevation tiers');
	const tierEnd = elevationGuidance.text.indexOf('\n<a id=', tierStart);
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
		tiers: { text: elevationGuidance.text.slice(tierStart, tierEnd), source: source(elevationGuidance.file, tierStart) },
		shadows: { text: shadowText.slice(shadowStart, shadowEnd).trim(), source: source(shadowFile, shadowStart), registrations: shadowRegistrations },
		cssShadows: [...read('src/vs/workbench/browser/media/style.css').matchAll(/^[ \t]*(?<css>--vscode-shadow-(?:sm|md|lg|xl)):\s*(?<value>[^;]+);/gm)]
			.filter(match => !match.groups.value.includes('transparent'))
			.map(match => ({ ...match.groups, source: source('src/vs/workbench/browser/media/style.css', match.index) })),
		shadowUsage: [...read('src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css').matchAll(/box-shadow:\s*(?<value>[^;]+);/g)]
			.map(match => ({ value: match.groups.value, source: source('src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css', match.index) })),
	};
return {elevation};
}
