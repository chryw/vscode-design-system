/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

const styles = 'src/vs/platform/theme/browser/defaultStyles.ts';
const evidence = [
	['surfaces', 'Notification surface and text', 'src/vs/workbench/browser/parts/notifications/media/notificationsList.css', 'color: var(--vscode-notifications-foreground);',
		'The shared notification container pairs its own foreground and background. Keep component-specific pairs together rather than borrowing a similar-looking surface.'],
	['hierarchy', 'Supporting text in Getting Started', 'src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css', 'color: var(--vscode-descriptionForeground);',
		'Getting Started repeatedly uses the description role for supporting text. Use hierarchy, not disabled styling, to make secondary content quieter.'],
	['buttons', 'Shared button defaults', styles, 'export const defaultButtonStyles',
		'These defaults feed the common Button component across many features. They define primary, secondary, hover, foreground, and border roles together.'],
	['button-states', 'Button interaction states', 'src/vs/base/browser/ui/button/button.ts', 'private updateStyles(hover: boolean)',
		'The common Button selects primary or secondary colors and changes the background on hover. Reuse the widget rather than recreating its state behavior.'],
	['validation', 'Shared input validation defaults', styles, 'export const defaultInputBoxStyles',
		'InputBox receives separate foreground, background, and border roles for error, warning, and information. A colored icon is not a substitute for this surface pairing.'],
	['validation-states', 'InputBox severity mapping', 'src/vs/base/browser/ui/inputbox/inputBox.ts', 'public stylesForType(',
		'InputBox maps each message severity to its matching validation family. An unset message foreground inherits; it is not automatically errorForeground.'],
	['notification-icons', 'Notification severity colors', 'src/vs/workbench/browser/parts/notifications/media/notificationsToasts.css', 'color: var(--vscode-notificationsErrorIcon-foreground)',
		'Notifications color the severity icon while keeping the message on the neutral notification surface. The warning and information rules use their corresponding icon roles.'],
	['notification-severity', 'Notification severity icons', 'src/vs/workbench/browser/parts/notifications/notificationsViewer.ts', 'private toSeverityIcon(',
		'Severity chooses distinct error, warning, and information icons. Pair the color with an icon and meaningful message instead of relying on hue.'],
	['testing', 'Passed test state', 'src/vs/workbench/contrib/testing/browser/media/testing.css', 'color: var(--vscode-testing-iconPassed);',
		'Testing keeps its existing component alias; new non-text success indicators use the shared color.icon.success role.'],
	['lists', 'Shared list selection defaults', styles, 'export const defaultListStyles',
		'List and tree styling separates hover, focus, active selection, and inactive selection. Focus is not the same state as selection.'],
	['contrast', 'Focus and contrast roles', 'src/vs/platform/theme/common/colors/baseColors.ts', 'export const focusBorder = registerColor(',
		'Focus and contrast borders have separate registrations, including high-contrast defaults. Do not replace them with a brand-colored box shadow.'],
];

export function load({ read, source }) {
	read('src/vs/workbench/test/browser/componentFixtures/baseUI.fixture.ts');
	return {
		colorUsage: evidence.map(([id, title, file, anchor, rationale]) => {
			const text = read(file);
			const offset = text.indexOf(anchor);
			if (offset < 0) { throw new Error(`Color usage evidence is missing: ${id} in ${file}`); }
			return { id, title, source: source(file, offset), rationale };
		}),
	};
}
