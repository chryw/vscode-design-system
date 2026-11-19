/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, sourceLink, problemDetails, showProblem, disclosureSummary } from './ui.mjs';
import {getTopic,topicId} from './topics/catalog.mjs';
import { pageJumps, topicPresentation } from './navigation-model.mjs';
import { createTopicLoader } from './topic-lifecycle.mjs';
import { documentMarkup, renderSourceSections } from './documents.mjs';

function composeChapter(stage, system, resolveResource) {
	if (!system.page?.source) { return; }
	const bindings = system.page.sections.filter(section => section.key);
	const sections = bindings.map(binding => {
		const copy = system.authored.sections[binding.key];
		const matches = [...stage.querySelectorAll('h2')].filter(heading => heading.textContent === copy.title);
		if (matches.length !== 1) { throw new Error(`Expected one rendered chapter section: ${binding.key}; found ${matches.length}`); }
		const element = matches[0].closest('section');
		if (!element || !stage.contains(element)) { throw new Error(`Missing rendered chapter section container: ${binding.key}`); }
		return { binding, element };
	});
	const parents = new Set(sections.map(section => section.element?.parentElement).filter(Boolean));
	if (parents.size > 1) { throw new Error('Chapter sections must share one composition container'); }
	const parent = [...parents][0] ?? stage;
	const markup = (text, id) => documentMarkup({ id: system.authored.markdownSource, markdown: text }, {
		level: 3, prefix: `${id}-`, resolveResource,
	});
	for (const section of sections) {
		const { binding } = section;
		section.element.id = binding.id;
		const description = section.element.querySelector(':scope > h2')?.nextElementSibling;
		if (description?.matches('p.muted')) { description.replaceWith(markup(description.textContent, binding.id)); }
		for (const alias of binding.aliases ?? []) {
			const anchor = node('span');
			anchor.id = alias;
			anchor.hidden = true;
			anchor.dataset.sectionAlias = 'true';
			section.element.prepend(anchor);
		}
	}
	if (sections.length) {
		const elements = new Set(sections.map(section => section.element));
		const first = [...parent.children].find(element => elements.has(element));
		const position = document.createTextNode('');
		first.before(position);
		for (const { element } of sections) { position.before(element); }
		position.remove();
	}
}

export function mountReference(root, props, host) {
	let snapshot;
	let query = props.query;
	let reloading = false;
	let anchorShown = false;
	const groupOpen = new Map();
	const previewState = new Map();
	const content = node('section', undefined, 'topic-content');
	content.id = 'content';
	content.setAttribute('aria-label', 'Design reference');
	const status = node('p', undefined, 'sr-only');
	status.id = 'status';
	status.setAttribute('role', 'status');
	const problem = problemDetails('problem');
	const heading = node('h1');
	const guidance = node('div', undefined, 'topic-intro');
	let metadata;
	const actions = node('footer', undefined, 'topic-actions');
	const sourceDocuments = node('details', undefined, 'contributor-resources');
	const references = node('details', undefined, 'topic-references');
	actions.hidden = true;
	actions.append(references, sourceDocuments);
	const outline = node('nav', undefined, 'article-outline');
	outline.setAttribute('aria-label', 'On this page');
	outline.hidden = true;
	const header = node('div', undefined, 'topic-heading');
	header.append(heading);
	const context = node('div', undefined, 'topic-context');
	context.append(header, outline);
	root.replaceChildren(context, guidance, problem, content, actions, status);
	const measureContext = () => {
		const height = context.getBoundingClientRect().height;
		const top = Number.parseFloat(getComputedStyle(context).top) || 0;
		root.style.setProperty('--topic-scroll-offset', `${height ? height + top + 16 : 24}px`);
	};
	const contextObserver = new ResizeObserver(measureContext);
	contextObserver.observe(context);
	root.ownerDocument.defaultView.addEventListener('resize', measureContext);
	const revealSection = target => {
		for (let element = target; element && element !== content; element = element.parentElement) {
			if (element instanceof HTMLDetailsElement) { element.open = true; }
		}
	};
	const showAnchor = () => {
		if (!props.anchor || anchorShown) {
			return;
		}
		let target = props.section === 'documentation'
			? root.querySelector(`#${CSS.escape(`document-${props.anchor}`)}`)
			: content.querySelector(`#${CSS.escape(props.anchor)}`);
		if (target?.dataset.sectionAlias) { target = target.closest('section'); }
		if (target) {
			anchorShown = true;
			revealSection(target);
			target.tabIndex = -1;
			target.focus({ preventScroll: true });
			target.scrollIntoView({ block: 'start' });
		}
	};
	const loader = createTopicLoader({
		read: (input, signal) => {
			if (input?.contentOnly && !reloading) {
				return snapshot;
			}
			reloading = true;
			return host.read(signal, Boolean(input?.force));
		},
		render: async (system, signal) => {
			const stage = node('div', undefined, props.section === 'motion' ? undefined : 'article-body');
			if (!['motion', 'iconography'].includes(props.section)) { stage.classList.add('article-flow'); }
			const model = { ...system, view: { ...system.view, ...props, query } };
			const entry = getTopic(topicId(props));
			const module = await import(`./${entry.renderer}`);
			if (signal.aborted) { throw new Error('Topic render cancelled'); }
			const result = await module.render(stage, model, {
				...host, groupOpen, previewState,
				onView: patch => { Object.assign(props, patch); host.onView(patch); },
				onQuery: value => { query = value; host.onQuery(value); },
				onSearch: value => {
					query = value;
					host.onQuery(value);
					void loader.refresh({ contentOnly: true });
				},
			}, signal);
			const presentation = typeof result === 'number' ? { count: result } : result;
			composeChapter(stage, system, host.documentResource);
			if (system.sourceSections?.length) {
				stage.classList.add('article-flow');
				renderSourceSections(stage, system.sourceSections, host.documentResource);
			}
			const labels = new Map(pageJumps(props, system.page).map(({ anchor, label }) => [anchor, label]));
			const sections = [...stage.querySelectorAll('h2')].filter(heading =>
				!heading.closest('.control-stage') || props.section === 'components').map((heading, index) => {
				const target = heading.closest('details, section') ?? heading;
				target.id ||= `${topicId(props)}-section-${index + 1}`;
				return { target, label: labels.get(target.id) ?? heading.textContent };
			});
			return { stage, ...presentation, sections, signal };
		},
		commit: ({ stage, count, context: documentContext, introduction, sections, signal }, system, input) => {
			const focused = document.activeElement;
			const focusedAnchor = content.contains(focused) && focused.tabIndex === -1 ? focused.id : '';
			const focusedSearch = root.querySelector('input[type="search"]');
			const restoreSearch = focusedSearch && document.activeElement === focusedSearch
				? { start: focusedSearch.selectionStart, end: focusedSearch.selectionEnd, value: focusedSearch.value } : undefined;
			snapshot = system;
			content.replaceChildren(stage);
			outline.replaceChildren();
			outline.hidden = sections.length < 2;
			if (!outline.hidden) {
				const list = node('ol');
				outline.append(list);
				const locations = [];
				let current;
				const selectLocation = link => {
					if (current === link) { return; }
					current?.removeAttribute('aria-current');
					link.setAttribute('aria-current', 'location');
					current = link;
				};
				for (const { target, label } of sections) {
					const link = node('a', label);
					const anchor = props.section === 'documentation' ? target.dataset.documentAnchor ?? target.id : target.id;
					link.href = `#${anchor}`;
					link.addEventListener('click', event => {
						if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
						event.preventDefault();
						revealSection(target);
						target.tabIndex = -1;
						target.focus({ preventScroll: true });
						target.scrollIntoView({ block: 'start' });
						selectLocation(link);
						props.anchor = anchor;
						anchorShown = true;
						host.onView({ anchor });
					}, { signal });
					const item = node('li');
					item.append(link);
					list.append(item);
					locations.push({ target, link });
				}
				const trackLocation = () => {
					if (!root.getClientRects().length) { return; }
					const location = locations.findLast(({ target }) => target.getBoundingClientRect().top <= Math.max(24, Number.parseFloat(getComputedStyle(target).scrollMarginTop)) + 1) ?? locations[0];
					selectLocation(location.link);
					if (current && !outline.matches(':hover, :focus-within')) {
						const bounds = current.getBoundingClientRect();
						const viewport = outline.getBoundingClientRect();
						if (bounds.left < viewport.left) { outline.scrollLeft -= viewport.left - bounds.left; }
						else if (bounds.right > viewport.right) { outline.scrollLeft += bounds.right - viewport.right; }
					}
				};
				const window = root.ownerDocument.defaultView;
				window.addEventListener('scroll', trackLocation, { passive: true, signal });
				window.addEventListener('resize', trackLocation, { signal });
				trackLocation();
			}
			content.dataset.topicState = 'ready';
			problem.hidden = true;
			status.textContent = query ? `${count ?? 0} matching entries` : 'Topic updated';
			if (restoreSearch) {
				const search = content.querySelector('input[type="search"]');
				if (search) {
					search.value = restoreSearch.value;
					search.focus({ preventScroll: true });
					search.setSelectionRange(restoreSearch.start, restoreSearch.end);
				}
				if (focusedAnchor) {
					const destination = content.querySelector(`#${CSS.escape(focusedAnchor)}`);
					if (destination) {
						destination.tabIndex = -1;
						destination.focus({ preventScroll: true });
					}
				}
			}
			if (input?.contentOnly) {
				host.onSnapshot(system);
				return;
			}
			const policy = topicPresentation(system, props);
			metadata?.remove();
			metadata = documentContext;
			if (metadata) { context.before(metadata); }
			heading.textContent = system.library?.document?.title ?? getTopic(topicId(props)).title;
			const documentTitle = system.library?.document?.headings.find(item => item.level === 1);
			heading.id = documentTitle ? `document-${documentTitle.id}` : '';
			guidance.replaceChildren(...(introduction ? [introduction] : []));
			if (!introduction && !system.library?.document) {
				const text = props.section === 'components' && props.controlId
					? system.controls.find(control => control.id === props.controlId).docs.summary
					: system.authored?.intro ?? system.motionDocumentation?.intro ?? '';
				if (text && system.authored?.markdownSource) {
					guidance.append(documentMarkup({ id: system.authored.markdownSource, markdown: text }, {
						level: 2, prefix: `${topicId(props)}-intro-`, resolveResource: host.documentResource,
					}));
				} else {
					guidance.textContent = text;
				}
			}
			const unavailable = props.section === 'components' && system.controls[0].content === 'tbd';
			guidance.hidden = unavailable || !guidance.hasChildNodes();
			sourceDocuments.replaceChildren();
			const sourceList = node('ul');
			const addSource = (source, label) => {
				const item = node('li');
				item.append(sourceLink(source, label), node('code', source.file, 'repository-path'));
				sourceList.append(item);
			};
			for (const document of system.sourceDocuments ?? []) {
				addSource(document.source, document.title);
			}
			if (!unavailable && policy.source && !system.sourceDocuments?.some(document => document.id === policy.source.file)
				&& system.sourceFiles.includes(policy.source.file)) {
				addSource(policy.source, policy.source.file.split('/').at(-1));
			}
			sourceDocuments.hidden = !sourceList.hasChildNodes();
			if (!sourceDocuments.hidden) {
				sourceDocuments.append(disclosureSummary('Contributor resources'), node('p', 'Open these repository files when updating this topic\'s guidance or implementation. Files open in a new tab.', 'muted'), sourceList);
			}
			references.replaceChildren();
			references.hidden = !system.topicReferences?.length;
			if (!references.hidden) {
				const list = node('ul');
				for (const reference of system.topicReferences) {
					const item = node('li');
					const link = node('a', reference.title);
					link.href = reference.url;
					link.target = '_blank';
					link.rel = 'noopener noreferrer';
					link.setAttribute('aria-label', `${reference.title} (opens in a new tab)`);
					item.append(link, node('p', reference.description, 'muted'));
					list.append(item);
				}
				references.append(disclosureSummary('Further reading'), list);
			}
			actions.hidden = references.hidden && sourceDocuments.hidden;
			measureContext();
			showAnchor();
			host.onSnapshot(system);
		},
		report: error => {
			const message = error.message.replace(/^Couldn't load the design system: /, '').replace(/[.!?]$/, '');
			showProblem(problem, snapshot ? 'Couldn\'t refresh this topic — showing last loaded content' : 'Couldn\'t load this topic — details', `${message}. Use Refresh to retry.`);
			content.dataset.topicState = 'error';
		},
		busy: value => {
			if (!value) {
				reloading = false;
			}
			root.setAttribute('aria-busy', String(value));
		},
	});
	const ready = loader.refresh();
	return {
		ready,
		refresh: force => loader.refresh({ force }),
		dispose: () => {
			loader.dispose();
			contextObserver.disconnect();
			root.ownerDocument.defaultView.removeEventListener('resize', measureContext);
			root.replaceChildren();
		},
	};
}
