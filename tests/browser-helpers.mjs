/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { motionControls } from './repository-helpers.mjs';


export function mockFixtureControl(id) {
	const motion = motionControls.find(control => control.id === id);
	return {
		id,
		variants: motion
			? motion.groups.flatMap(group => ['Light', 'Dark'].map(variant => ({ id: `${group}/${variant}`, name: `${motion.groupLabels[group]} · ${variant}`, variant })))
			: ['Light', 'Dark'].map(name => ({ id: `${id}/${name}`, name })),
	};
}

export async function mockFixtureRenderer(page, root, controlIds) {
	await page.route('**/api/fixtures*', route => route.fulfill({
		json: { checkoutPath: root, session: 'test', sourceTreeId: 'test-tree',
			explorerUrl: 'http://127.0.0.1:43111/___explorer',
			controls: controlIds.map(mockFixtureControl) },
	}));
	await page.route('http://127.0.0.1:43111/___explorer?*', route => route.fulfill({
		contentType: 'text/html',
		body: `<!doctype html><p>Live example</p><script>
			addEventListener('message', event => {
				if (event.data.type === 'component-explorer:embedded-init' || event.data.type === 'component-explorer:embedded-input') {
					window.fixtureInput = event.data.input;
				}
				if (event.data.type === 'component-explorer:embedded-init') {
					parent.postMessage({ type: 'component-explorer:ready', fixtureId: new URL(location.href).searchParams.get('fixture') }, '*');
				}
			});
			parent.postMessage({ type: 'component-explorer:embedded-loaded' }, '*');
		</script>`,
	}));
}
