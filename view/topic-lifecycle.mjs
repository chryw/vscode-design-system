/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

export function createTopicLoader({ read, render, commit, report, busy }) {
	let sequence = 0;
	let pending;
	let active;
	let disposed = false;
	return {
		async refresh(input) {
			if (disposed) {
				return;
			}
			const version = ++sequence;
			pending?.abort();
			const controller = new AbortController();
			pending = controller;
			const current = () => !disposed && version === sequence;
			busy(true);
			try {
				const data = await read(input, controller.signal);
				if (!current()) {
					return;
				}
				const result = await render(data, controller.signal, input);
				if (current()) {
					active?.abort();
					active = controller;
					pending = undefined;
					commit(result, data, input);
				}
			} catch (error) {
				if (current()) {
					report(error);
				}
			} finally {
				if (pending === controller) {
					pending = undefined;
				}
				if (active !== controller) {
					controller.abort();
				}
				if (current()) {
					busy(false);
				}
			}
		},
		dispose() {
			disposed = true;
			sequence++;
			pending?.abort();
			active?.abort();
		},
	};
}
