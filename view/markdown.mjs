/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- No-build, non-executing Markdown presentation. */
import { parseDocument } from '../model/documents.mjs';

function inline(target, text, options) {
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|!?\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\))/g;
	let offset = 0;
	for (const match of text.matchAll(pattern)) {
		target.append(text.slice(offset, match.index));
		const part = match[0];
		if (part.startsWith('`')) {
			const code = document.createElement('code');
			code.textContent = part.slice(1, -1);
			target.append(code);
		} else if (part.startsWith('**')) {
			const strong = document.createElement('strong');
			strong.textContent = part.slice(2, -2);
			target.append(strong);
		} else {
			const link = part.match(/^(?<image>!)?\[(?<label>[^\]]*)\]\((?<target><[^>]+>|[^\s)]+)/).groups;
			const href = link.target.replace(/^<|>$/g, '');
			const resolved = options.resolveReference?.(href, Boolean(link.image));
			if (resolved?.image) {
				const image = document.createElement('img');
				image.src = resolved.href;
				image.alt = link.label;
				image.loading = 'lazy';
				image.addEventListener('error', () => {
					const message = document.createElement('p');
					message.setAttribute('role', 'status');
					message.textContent = `Couldn't load image: ${link.label || href}`;
					image.replaceWith(message);
				}, { once: true });
				target.append(image);
			} else if (resolved?.href) {
				const element = document.createElement('a');
				element.href = resolved.href;
				element.textContent = link.label || href;
				if (resolved.external) { element.target = '_blank'; element.rel = 'noopener noreferrer'; }
				target.append(element);
			} else if (resolved?.problem) {
				const invalid = document.createElement('span');
				invalid.textContent = `${link.label || href} (invalid reference)`;
				invalid.title = resolved.problem;
				target.append(invalid);
			} else { target.append(link.label || href); }
		}
		offset = match.index + part.length;
	}
	target.append(text.slice(offset));
}

function tableCells(line) {
	const cells = [];
	let value = '';
	let code = false;
	let escaped = false;
	for (const character of line.trim().replace(/^\||\|$/g, '')) {
		if (escaped) { value += character; escaped = false; continue; }
		if (character === '\\') { escaped = true; continue; }
		if (character === '`') { code = !code; }
		if (character === '|' && !code) { cells.push(value.trim()); value = ''; }
		else { value += character; }
	}
	cells.push(value.trim());
	return cells;
}

export function markdown(text, headingLevel = 3, options = {}) {
	const parsed = parseDocument(text);
	const content = document.createElement('div');
	content.className = 'prose';
	const lines = parsed.markdown.split('\n');
	const firstTitle = options.skipTitle ? parsed.headings.find(heading => heading.level === 1) : undefined;
	const headings = parsed.headings.filter(heading => heading !== firstTitle);
	const headingsByOffset = new Map(parsed.headings.map(heading => [heading.offset, heading]));
	const baseLevel = headings.length ? Math.min(...headings.map(heading => heading.level)) : 1;
	let code;
	let fence;
	let table;
	let paragraph;
	let comment = false;
	let offset = 0;
	let headingIndex = 0;
	const lists = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const currentOffset = offset;
		offset += line.length + 1;
		const delimiter = line.match(/^\s*(?<marker>`{3,}|~{3,})(?<language>.*)$/);
		if (code) {
			if (delimiter && delimiter.groups.marker[0] === fence[0] && delimiter.groups.marker.length >= fence.length) {
				code = undefined; fence = undefined;
			} else { code.textContent += `${line}\n`; }
			continue;
		}
		if (delimiter) {
			const pre = document.createElement('pre');
			code = document.createElement('code');
			code.textContent = '';
			if (delimiter.groups.language.trim()) { pre.setAttribute('aria-label', `${delimiter.groups.language.trim()} code`); }
			pre.append(code); content.append(pre); fence = delimiter.groups.marker;
			table = undefined; paragraph = undefined; lists.length = 0;
			continue;
		}
		if (comment || /^\s*<!--/.test(line)) {
			comment = !line.includes('-->');
			continue;
		}
		if (/^\s*<a\s+id=/.test(line) || line === '---') { continue; }
		const heading = headingsByOffset.get(currentOffset);
		if (heading) {
			const original = options.headings?.[headingIndex++] ?? heading;
			if (heading.underline) { offset += lines[++index].length + 1; }
			if (heading === firstTitle) { continue; }
			const element = document.createElement(`h${Math.min(6, headingLevel + heading.level - baseLevel)}`);
			if (options.anchors) {
				element.id = `${options.prefix ?? ''}${original.id}`;
				element.dataset.documentAnchor = original.id;
				for (const alias of (original.aliases ?? []).filter(alias => alias !== original.id)) {
					const marker = document.createElement('span');
					marker.id = `${options.prefix ?? ''}${alias}`;
					content.append(marker);
				}
			}
			inline(element, heading.rawTitle, options);
			content.append(element);
			table = undefined; paragraph = undefined; lists.length = 0;
			continue;
		}
		if (/^\|/.test(line.trim())) {
			const cells = tableCells(line);
			if (cells.every(cell => /^:?-+:?$/.test(cell))) { continue; }
			if (!table) {
				const wrapper = document.createElement('div');
				wrapper.className = 'table-scroll';
				table = document.createElement('table');
				wrapper.append(table); content.append(wrapper);
			}
			const row = document.createElement('tr');
			for (const cell of cells) {
				const entry = document.createElement(table.rows.length ? 'td' : 'th');
				if (!table.rows.length) { entry.scope = 'col'; }
				inline(entry, cell, options); row.append(entry);
			}
			table.append(row); paragraph = undefined; lists.length = 0;
			continue;
		}
		table = undefined;
		if (!line.trim()) { paragraph = undefined; lists.length = 0; continue; }
		const bullet = line.match(/^(?<indent>\s*)(?:(?<number>\d+)\.|[-*])\s+(?<text>.*)/);
		if (bullet) {
			const indent = bullet.groups.indent.replaceAll('\t', '    ').length;
			const tag = bullet.groups.number ? 'ol' : 'ul';
			while (lists.length && (lists.at(-1).indent > indent || lists.at(-1).indent === indent && lists.at(-1).tag !== tag)) { lists.pop(); }
			if (!lists.length || lists.at(-1).indent < indent) {
				const element = document.createElement(tag);
				if (bullet.groups.number) { element.start = Number(bullet.groups.number); }
				(lists.at(-1)?.item ?? content).append(element);
				lists.push({ indent, tag, element });
			}
			const item = document.createElement('li');
			inline(item, bullet.groups.text, options);
			lists.at(-1).element.append(item); lists.at(-1).item = item; paragraph = undefined;
			continue;
		}
		const indentation = line.match(/^\s*/)[0].replaceAll('\t', '    ').length;
		while (lists.length > 1 && indentation <= lists.at(-1).indent) { lists.pop(); }
		if (lists.length && indentation > lists.at(-1).indent) {
			lists.at(-1).item.append(' ');
			inline(lists.at(-1).item, line.trim(), options);
			paragraph = undefined;
			continue;
		}
		lists.length = 0;
		if (options.paragraphs && paragraph && !line.startsWith('>')) {
			paragraph.append(' '); inline(paragraph, line.trim(), options);
		} else {
			paragraph = document.createElement(line.startsWith('>') ? 'blockquote' : 'p');
			inline(paragraph, line.replace(/^>\s*/, ''), options); content.append(paragraph);
		}
	}
	return content;
}
