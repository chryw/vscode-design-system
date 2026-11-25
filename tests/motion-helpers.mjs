/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Test-only Motion composition inputs. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { workspaceRoot } from '../runtime/paths.mjs';
import { parseSpecMetadata, repositoryDirectory } from '../runtime/book.mjs';
import { readMotionPage } from '../adapters/vscode/groups/motion-source.mjs';

const yaml = createRequire(`${workspaceRoot}/package.json`)('js-yaml');
const frontMatter = /^(?:\uFEFF)?---\r?\n(?<yaml>[\s\S]*?)\r?\n---(?:\r?\n|$)/;

export const motionGuidanceFile = `${repositoryDirectory}/foundations/motion.design.md`;
export const motionSpec = parseSpecMetadata(readFileSync(`${workspaceRoot}/${motionGuidanceFile}`, 'utf8'), motionGuidanceFile, 'foundation');
export const hasRichMotion = motionSpec.presentation === 'motion';
export const motionImplementationFile = motionSpec.specimens?.sources?.[0]?.file;
export const motionTextFile = motionSpec.specimens?.textSource;
export const motionProjection = { mode: 'authored', book: { topics: [{ id: 'motion', page: motionGuidanceFile }] }, designSpecs: [motionSpec] };

/** Older checkouts bind a separate page descriptor; tests keep this path only for compatibility coverage. */
export const legacyMotionPageFile = `${repositoryDirectory}/content/topics/motion.json`;
export const legacyMotionProjection = { book: { topics: [{ id: 'motion', page: 'content/topics/motion.json' }] } };

/** Reads visual bindings independently of the Markdown-owned chapter hierarchy. */
export function motionComposition(text) {
	return yaml.load(frontMatter.exec(text).groups.yaml).specimens;
}

/** Applies `edit` to Motion `specimens` in descriptor shape and returns the saved text; a function mutates, an object replaces. */
export function withMotionComposition(text, edit) {
	const match = frontMatter.exec(text);
	const metadata = yaml.load(match.groups.yaml);
	let page = motionComposition(text);
	if (typeof edit === 'function') { edit(page); } else { page = edit; }
	metadata.specimens = page;
	return `---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true })}---\n${text.slice(match[0].length)}`;
}

export function moveMotionStylesFirst(text) {
	const from = text.indexOf('<a id="motion-styles">');
	const end = text.indexOf('<a id="motion-foundations">');
	const before = text.indexOf('<a id="motion-when-to-use">');
	if (from < 0 || end <= from || before < 0 || before >= from) { throw new Error('Missing Motion headings to reorder'); }
	return text.slice(0, before) + text.slice(from, end) + text.slice(before, from) + text.slice(end);
}

/** The page descriptor an older checkout would declare for the same Motion composition. */
export function legacyMotionDescriptor(text) {
	return readMotionPage({
		repository: { projection: motionProjection },
		read: file => file === motionGuidanceFile ? text : readFileSync(`${workspaceRoot}/${file}`, 'utf8'),
		source: (file, offset) => ({ file, line: offset + 1 }),
	}, { status: 'absent', tokens: [], recipes: [] }).page;
}
