/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build source-document metadata. */
import { parseDocument } from '../../../model/documents.mjs';

export function load({ read }, files) {
	return {
		sourceDocuments: files.map(file => {
			const document = parseDocument(read(file), { id: file });
			return { id: file, title: document.title, source: document.source };
		}),
	};
}
