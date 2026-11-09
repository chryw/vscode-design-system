/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import { node, variantChoices } from './ui.mjs';
import { renderFixturePreview } from './components.mjs';
import { motionControls } from './controls.mjs';
import { motionExample, motionSection } from './motion-recipes.mjs';
import { markdown } from './markdown.mjs';

export function appendMotionMarkdown(parent, text) {
	if (text) {
		parent.append(...markdown(text, 3, {
			resolveReference: target => /^#motion-[a-z0-9-]+$/.test(target) || target === '?section=tokens#tokens-motion' ? { href: target } : undefined,
		}).childNodes);
	}
}

function appendCaption(parent, text) {
	if (!text) { return; }
	const caption = node('div', undefined, 'motion-doc-caption');
	appendMotionMarkdown(caption, text);
	parent.append(caption);
}

function pivot(label, options, selected, onChange) {
	const group = variantChoices(label, options, selected, onChange);
	group.classList.add('motion-doc-pivot');
	return group;
}

function playbackIcon(kind, model) {
	const id = { Play: 'play', Pause: 'debug-pause', Reset: 'debug-restart' }[kind];
	return productIcon(id, model);
}

function productIcon(id, model) {
	const icon = model.icons.find(icon => icon.id === id && icon.fontAvailable);
	if (!icon) { throw new Error(`Missing product playback icon: ${id}`); }
	const element = node('span', String.fromCodePoint(Number.parseInt(icon.code, 16)), `codicon codicon-${id} codicon-glyph`);
	element.setAttribute('aria-hidden', 'true');
	return element;
}

function createPlayback(title, model) {
	const playback = node('div', undefined, 'motion-doc-playback');
	playback.setAttribute('role', 'group');
	playback.setAttribute('aria-label', `Playback: ${title}`);
	const button = node('button', undefined, 'monaco-button monaco-text-button default-colors secondary motion-doc-playback-button');
	button.type = 'button';
	playback.append(button);
	const update = (playing, ended = false) => {
		const label = playing ? 'Pause' : ended ? 'Reset' : 'Play';
		button.replaceChildren(playbackIcon(label, model));
		button.title = label;
		button.setAttribute('aria-label', `${label}: ${title}`);
	};
	return { playback, button, update };
}

function reducedMotionControl(checked, onChange, signal) {
	const label = node('label', undefined, 'motion-doc-reduced');
	const input = node('input');
	input.type = 'checkbox';
	input.checked = checked;
	input.addEventListener('change', () => onChange(input.checked), { signal });
	label.append(input, node('span', 'Reduced motion'));
	return { label, input };
}

const tokenValue = (model, id) => {
	const token = model.tokens.find(token => token.id === id);
	if (!token) { throw new Error(`Missing motion parameter: ${id}`); }
	return token.value;
};

function diagramPlayer(viewer, model, title, tracks, signal, { onPlay, onReset } = {}) {
	const tools = node('div', undefined, 'motion-doc-preview-tools');
	const controls = createPlayback(title, model);
	const problem = node('p', undefined, 'motion-doc-playback-error');
	problem.setAttribute('role', 'alert');
	problem.hidden = true;
	const preference = matchMedia('(prefers-reduced-motion: reduce)');
	let animations = [];
	let playing = false;
	let ended = false;
	let generation = 0;
	const update = () => {
		controls.update(playing, ended);
		viewer.dataset.playbackState = playing ? 'playing' : ended ? 'finished' : 'paused';
	};
	const pause = () => {
		playing = false;
		for (const animation of animations) {
			const time = animation.currentTime;
			animation.pause();
			animation.currentTime = time ?? 0;
		}
		update();
	};
	const cancel = () => {
		generation++;
		pause();
		for (const animation of animations) { animation.cancel(); }
		animations = [];
	};
	const prepare = () => {
		cancel();
		animations = tracks.map(track => {
			const animation = track.element.animate(track.frames, {
				duration: preference.matches ? 0 : track.duration, easing: track.easing ?? 'linear', fill: 'both',
			});
			animation.pause();
			animation.currentTime = 0;
			return animation;
		});
		ended = false;
		update();
	};
	const reset = () => {
		cancel();
		ended = false;
		for (const track of tracks) {
			for (const [property, value] of Object.entries(track.frames[0])) {
				if (!['offset', 'easing', 'composite'].includes(property)) { track.element.style[property] = value; }
			}
		}
		problem.hidden = true;
		onReset?.();
		update();
	};
	const play = async () => {
		if (!animations.length) { prepare(); }
		playing = true;
		const current = generation;
		onPlay?.();
		update();
		for (const animation of animations) { animation.play(); }
		try {
			await Promise.all(animations.map(animation => animation.finished));
			if (generation !== current || signal?.aborted) { return; }
			playing = false;
			ended = true;
			update();
		} catch (error) {
			if (error.name === 'AbortError') { return; }
			pause();
			problem.textContent = `Couldn't play this example: ${error.message}`;
			problem.hidden = false;
		}
	};
	controls.button.addEventListener('click', () => ended ? reset() : playing ? pause() : void play(), { signal });
	const settle = () => {
		if (!animations.length && !playing && !ended) { return; }
		prepare();
		for (const animation of animations) { animation.currentTime = animation.effect.getComputedTiming().endTime; }
		onPlay?.();
		ended = true;
		update();
	};
	preference.addEventListener('change', settle, { signal });
	document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); } }, { signal });
	const observer = new IntersectionObserver(entries => {
		if (!entries[0].isIntersecting && playing) { pause(); }
	});
	observer.observe(viewer);
	signal?.addEventListener('abort', () => {
		generation++;
		observer.disconnect();
		for (const animation of animations) { animation.cancel(); }
	}, { once: true });
	tools.append(controls.playback);
	viewer.append(tools, problem);
	reset();
}

export function renderPropertySpecimen(parent, model, { id, title, shape = 'square', frames, endpoints, response, tokens, caption }, signal) {
	const viewer = node('div', undefined, 'motion-doc-viewer motion-doc-specimen');
	if (response) { viewer.dataset.motionResponse = response.id; }
	const stage = node('div', undefined, 'motion-doc-stage motion-doc-specimen-stage');
	stage.dataset.shape = shape;
	const target = node('div', undefined, 'motion-doc-specimen-target');
	const endpointLabels = (typeof endpoints === 'function' ? endpoints(model) : endpoints) ?? ['Initial state', 'Final state'];
	stage.setAttribute('aria-label', `${title}: ${endpointLabels.join(' to ')}`);
	stage.setAttribute('role', 'img');
	stage.append(node('div', undefined, 'motion-doc-specimen-outline'));
	if (shape === 'travel') {
		stage.append(node('div', undefined, 'motion-doc-specimen-outline motion-doc-specimen-destination'));
	}
	stage.append(target);
	viewer.append(stage);
	diagramPlayer(viewer, model, title, [{
		element: target, frames: frames(model),
		duration: response?.durationMs ?? Number.parseFloat(tokenValue(model, tokens?.[0] ?? 'motion.duration.slow')),
		easing: response?.easing ?? tokenValue(model, tokens?.[1] ?? 'motion.easing.linear'),
	}], signal);
	parent.append(viewer);
	appendCaption(parent, caption);
}

export function renderResponseSpecimens(parent, model, signal) {
	if (!model.responses.length) {
		parent.append(node('p', 'Motion timing is not available in this checkout.'));
		return;
	}
	const grid = node('div', undefined, 'motion-doc-specimens');
	for (const binding of model.page.responses) {
		const response = model.responses.find(response => response.id === binding.id);
		if (!response) { throw new Error(`Missing motion response: ${binding.id}`); }
		const item = node('div', undefined, 'motion-doc-specimen-item');
		const header = node('header');
		header.append(node('h4', response.label));
		appendMotionMarkdown(header, binding.description);
		item.append(header);
		renderPropertySpecimen(item, model, {
			id: response.id, title: response.label, shape: 'travel', response,
			frames: () => [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }],
			endpoints: ['Origin', 'Destination'],
		}, signal);
		grid.append(item);
	}
	parent.append(grid);
}

function easingCurve(value) {
	const keywords = {
		linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1],
		'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1],
	};
	const points = keywords[value] ?? value.match(/cubic-bezier\((?<points>[^)]+)\)/)?.groups.points.split(',').map(Number);
	const samples = value.match(/^linear\((?<samples>[\d.,\s-]+)\)$/)?.groups.samples.split(',').map(Number);
	if ((!points || points.length !== 4 || points.some(value => !Number.isFinite(value))) && (!samples || samples.length < 2 || samples.some(value => !Number.isFinite(value)))) {
		throw new Error(`Unsupported comparison curve: ${value}`);
	}
	const curve = samples
		? samples.map((sample, index) => `${index === 0 ? 'M' : 'L'}${16 + 208 * index / (samples.length - 1)} ${144 - 128 * sample}`).join(' ')
		: `M16 144 C${16 + 208 * points[0]} ${144 - 128 * points[1]} ${16 + 208 * points[2]} ${144 - 128 * points[3]} 224 16`;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 240 160');
	svg.setAttribute('aria-hidden', 'true');
	for (const [path, className] of [
		['M16 16 V144 H224', 'motion-doc-curve-axis'],
		[curve, 'motion-doc-curve-path'],
	]) {
		const line = document.createElementNS(svg.namespaceURI, 'path');
		line.setAttribute('d', path);
		line.setAttribute('class', className);
		svg.append(line);
	}
	const horizontal = document.createElementNS(svg.namespaceURI, 'g');
	const marker = document.createElementNS(svg.namespaceURI, 'circle');
	marker.classList.add('motion-doc-curve-marker');
	horizontal.append(marker);
	svg.append(horizontal);
	return { svg, horizontal, marker };
}

export function renderTimingComparison(parent, model, kind, signal, presentation, level = 3) {
	if (kind === 'easing') {
		appendMotionMarkdown(parent, model.page.curveNote);
		const grid = node('div', undefined, 'motion-doc-easing-grid');
		for (const binding of model.page.easings) {
			const { heading, variants, caption, tokens } = binding;
			const authored = motionSection(model, heading);
			const title = binding.title ?? authored.title;
			const description = binding.description ?? authored.markdown;
			const item = node('article', undefined, 'motion-doc-curve');
			const header = node('header');
			header.append(node(`h${level + 1}`, title));
			appendMotionMarkdown(header, description);
			item.append(header);
			let lifetime = new AbortController();
			signal.addEventListener('abort', () => lifetime.abort(), { once: true });
			let viewer;
			const render = name => {
				lifetime.abort();
				lifetime = new AbortController();
				const id = name;
				const next = node('div', undefined, 'motion-doc-viewer');
				next.dataset.motionCurve = id;
				const stage = node('div', undefined, 'motion-doc-stage motion-doc-curve-stage');
				stage.setAttribute('role', 'img');
				stage.setAttribute('aria-label', `${title} timing curve: elapsed time increases horizontally, progress increases vertically.`);
				const { svg, horizontal, marker } = easingCurve(tokenValue(model, id));
				stage.append(svg);
				next.append(stage);
				const duration = Number.parseFloat(tokenValue(model, tokens[0]));
				next.dataset.motionDuration = tokens[0];
				diagramPlayer(next, model, title, [
					{ element: horizontal, frames: [{ transform: 'translateX(16px)' }, { transform: 'translateX(224px)' }], duration, easing: 'linear' },
					{ element: marker, frames: [{ transform: 'translateY(144px)' }, { transform: 'translateY(16px)' }], duration, easing: tokenValue(model, id) },
				], lifetime.signal);
				if (viewer) { viewer.replaceWith(next); } else { item.append(next); }
				viewer = next;
			};
			if (variants.length > 1) {
				header.append(pivot(`${title} curve`, variants.map(([id, name]) => ({ id, name })), variants[0][0], render));
			}
			render(variants[0][0]);
			appendCaption(item, caption);
			grid.append(item);
		}
		parent.append(grid);
		return;
	}
	const study = node('section', undefined, 'motion-doc-duration-study');
	study.id = 'motion-duration';
	appendMotionMarkdown(study, model.page.durationIntro);
	const viewer = node('div', undefined, 'motion-doc-viewer motion-doc-duration-viewer');
	const comparison = node('div', undefined, 'motion-doc-duration-comparison');
	const guidance = node('div', undefined, 'motion-doc-duration-guidance');
	const tracks = [];
	for (const entry of model.page.durations) {
		const duration = model.tokens.find(token => token.id === entry.tokens[0]);
		const row = node('div', undefined, 'motion-doc-duration');
		row.dataset.durationExample = entry.id;
		row.append(node('span', `${entry.title} · ${duration.value}`));
		const band = node('div', undefined, 'motion-doc-duration-band');
		band.setAttribute('role', 'img');
		band.setAttribute('aria-label', `${entry.title}: identical linear change over ${duration.value}`);
		const fill = node('div', undefined, 'motion-doc-duration-fill');
		fill.dataset.motionDuration = duration.id;
		band.append(fill);
		row.append(band);
		comparison.append(row);
		tracks.push({ element: fill, frames: [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], duration: duration.number, easing: 'linear' });
		const choice = node('section');
		choice.append(node(`h${level + 1}`, `${entry.title} · ${duration.value}`));
		appendMotionMarkdown(choice, entry.description);
		guidance.append(choice);
	}
	viewer.append(comparison);
	diagramPlayer(viewer, model, 'Compare durations', tracks, signal);
	study.append(viewer, guidance);
	appendMotionMarkdown(study, model.page.durationNote);
	parent.append(study);
	return study;
}

function silhouetteLines(parent, count = 3) {
	for (let index = 0; index < count; index++) { parent.append(node('div', undefined, 'motion-doc-silhouette-line')); }
}

function createMotionScene(stage, model, kind, { duration, direction = 'inline-start' } = {}) {
	const track = (element, frames, duration, easing, extra = {}) => ({
		element, frames, duration: Number.parseFloat(tokenValue(model, duration)), easing: tokenValue(model, easing), ...extra,
	});
	let tracks;
	if (kind === 'layout' && direction === 'flow') {
		stage.dataset.direction = direction;
		const stack = node('div', undefined, 'motion-doc-layout-stack');
		const target = node('div', undefined, 'motion-doc-layout-details');
		stack.append(node('div', undefined, 'motion-doc-specimen-bar'), target, node('div', undefined, 'motion-doc-specimen-bar'));
		stage.append(stack);
		tracks = [track(target, [{ height: '0px' }, { height: 'calc(var(--vscode-spacing-size320) * 2)' }], 'motion.disclosure.duration', 'motion.disclosure.easing')];
	} else if (kind === 'layout') {
		stage.dataset.direction = direction;
		const layout = node('div', undefined, 'motion-doc-layout-frame');
		const main = node('div', undefined, 'motion-doc-layout-main');
		silhouetteLines(main);
		const target = node('div', undefined, 'motion-doc-layout-expansion');
		const clip = node('div');
		const panel = node('div', undefined, 'motion-doc-layout-panel');
		silhouetteLines(panel);
		clip.append(panel);
		target.append(clip);
		layout.append(target, main);
		stage.append(layout);
		tracks = [
			track(target, [{ [direction === 'inline-start' ? 'gridTemplateColumns' : 'gridTemplateRows']: '0fr' }, { [direction === 'inline-start' ? 'gridTemplateColumns' : 'gridTemplateRows']: '1fr' }], duration ?? 'motion.disclosure.duration', 'motion.easing.easeInOut'),
			track(target, [{ opacity: 0 }, { opacity: 1 }], duration ?? 'motion.disclosure.opacity.duration', 'motion.easing.easeInOut'),
		];
	} else if (kind === 'content') {
		const context = node('div', undefined, 'motion-doc-content-context');
		const steps = node('div', undefined, 'motion-doc-content-steps');
		for (let index = 0; index < 3; index++) { steps.append(node('div')); }
		const layers = node('div', undefined, 'motion-doc-content-layers');
		const content = node('div', undefined, 'motion-doc-content-old');
		const target = node('div', undefined, 'motion-doc-content-new');
		for (let index = 0; index < 3; index++) {
			const before = node('div');
			const after = node('div');
			silhouetteLines(before, 2);
			silhouetteLines(after, 2);
			content.append(before);
			target.append(after);
		}
		layers.append(content, target);
		context.append(steps, layers);
		stage.append(context);
		tracks = [
			track(target, [{ opacity: 0 }, { opacity: 1 }], duration ?? 'motion.content.duration', 'motion.easing.linear'),
			{ element: content, frames: [{ opacity: 1 }, { opacity: 0 }], duration: 0, easing: 'linear' },
			track(steps.children[0], [{ backgroundColor: 'var(--vscode-button-background)' }, { backgroundColor: 'var(--vscode-button-secondaryBackground)' }], 'motion.duration.none', 'motion.easing.linear'),
			track(steps.children[1], [{ backgroundColor: 'var(--vscode-button-secondaryBackground)' }, { backgroundColor: 'var(--vscode-button-background)' }], 'motion.duration.none', 'motion.easing.linear'),
		];
	} else if (kind === 'notification') {
		const edge = node('div', undefined, 'motion-doc-notification-edge');
		silhouetteLines(edge);
		const target = node('div', undefined, 'motion-doc-notification-surface');
		target.append(node('div', undefined, 'motion-doc-notification-mark'), node('div', undefined, 'motion-doc-notification-lines'));
		stage.append(edge, target);
		tracks = [track(target, [
			{ opacity: 0, transform: 'translateY(100%)' },
			{ opacity: 1, transform: 'translateY(0)' },
		], duration ?? 'motion.toast.duration', 'motion.toast.easing')];
	} else {
		throw new Error(`Unknown motion recipe illustration: ${kind}`);
	}
	return { tracks };
}

export function renderRecipeDiagram(parent, model, { id: kind, title, direction }, signal) {
	const viewer = node('div', undefined, 'motion-doc-viewer');
	viewer.dataset.motionDiagram = kind;
	if (direction) { viewer.dataset.motionDirection = direction; }
		const stage = node('div', undefined, `motion-doc-stage motion-doc-scene motion-doc-scene-${kind}`);
		stage.setAttribute('role', 'img');
		stage.setAttribute('aria-label', title);
		const scene = createMotionScene(stage, model, kind, { direction });
	viewer.append(stage);
	if (kind === 'layout') {
		const preference = matchMedia('(prefers-reduced-motion: reduce)');
		const bindings = new Map();
		let expanded = false;
		let visible = true;
		for (const track of scene.tracks) {
			const entries = bindings.get(track.element) ?? [];
			for (const property of Object.keys(track.frames[0])) {
				const css = property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
				entries.push(`${css} ${track.duration}ms ${track.easing}`);
			}
			bindings.set(track.element, entries);
		}
		const updateTransitions = () => {
			for (const [element, properties] of bindings) {
				element.style.transition = preference.matches || !visible || document.hidden ? 'none' : properties.join(', ');
			}
		};
		const tools = node('div', undefined, 'motion-doc-preview-tools');
		const button = node('button', undefined, 'monaco-button monaco-text-button default-colors secondary motion-doc-layout-toggle');
		button.type = 'button';
		const update = () => {
			for (const track of scene.tracks) { Object.assign(track.element.style, track.frames[expanded ? 1 : 0]); }
			button.textContent = expanded ? 'Collapse' : 'Expand';
			button.setAttribute('aria-label', `${button.textContent}: ${title}`);
			button.setAttribute('aria-expanded', String(expanded));
			viewer.dataset.expanded = String(expanded);
		};
		update();
		updateTransitions();
		button.addEventListener('click', () => { expanded = !expanded; update(); }, { signal });
		preference.addEventListener('change', updateTransitions, { signal });
		document.addEventListener('visibilitychange', updateTransitions, { signal });
		const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; updateTransitions(); });
		observer.observe(viewer);
		signal.addEventListener('abort', () => observer.disconnect(), { once: true });
		tools.append(button);
		viewer.append(tools);
	} else { diagramPlayer(viewer, model, title, scene.tracks, signal, scene); }
	parent.append(viewer);
}

export function renderMotionExample(parent, model, { id, fixtureId = id, title, usageMarkdown, caption, action = 'enter', interactive = false, variants, variantLabel = 'Shape', heading = 'h3', bare = false, playback: showPlayback = true }, signal, presentation) {
	const control = motionControls.find(control => control.id === `motion-${fixtureId}`);
	if (!control) { throw new Error(`Missing motion example: ${id}`); }
	const card = bare ? parent : node('article', undefined, 'motion-doc-example');
	card.id = `motion-example-${id}`;
	card.tabIndex = -1;
	card.dataset.motionExample = id;
	const analysis = model.page.analyses?.find(entry => entry.exampleId === fixtureId);
	if (analysis) { card.dataset.motionAnalysis = analysis.id; }
	const intro = node('header');
	if (heading) { intro.append(node(heading, title)); }
	appendMotionMarkdown(intro, usageMarkdown);
	if (!bare) { card.append(intro); }
	const stateKey = `motion-${id}`;
	const previous = presentation.previewState.get(stateKey);
	let state = {
		action: 'reset', sequence: 0, paused: !interactive,
		reduced: previous?.reduced ?? false,
		playbackRate: 1,
	};
	let started = false;
	let ended = false;
	let preview;
	let ready = false;
	const viewer = node('div', undefined, 'motion-doc-viewer motion-doc-product-viewer');
	const host = node('div', undefined, 'motion-doc-stage motion-doc-product-stage');
	const source = node('div', undefined, 'source-action');
	const chrome = node('div', undefined, 'motion-doc-preview-tools');
	const inputs = [];
	const setDisabled = disabled => {
		for (const input of inputs) { input.disabled = disabled; input.classList.toggle('disabled', disabled); }
	};
	const send = () => preview.updateInput({ motion: state, enableAnimations: true });
	const save = () => presentation.previewState.set(stateKey, {
		reduced: state.reduced, variant: state.variant,
	});
	const { playback, button, update } = createPlayback(title, model);
	const updatePlayback = () => update(started && !state.paused, ended);
	const start = () => {
		state = { ...state, action, sequence: state.sequence + 1, paused: false };
		started = true;
		ended = false;
		updatePlayback();
		send();
	};
	button.addEventListener('click', () => {
		if (ended) {
			state = { ...state, action: 'reset', sequence: state.sequence + 1, paused: !interactive };
			started = false;
			ended = false;
			updatePlayback();
			send();
		} else if (!started) { start(); }
		else { state = { ...state, paused: !state.paused }; updatePlayback(); send(); }
	}, { signal });
	updatePlayback();
	inputs.push(button);
	if (variants) {
		state.variant = previous?.variant ?? variants[0].id;
		const choices = pivot(variantLabel, variants, state.variant, value => {
			state = { ...state, variant: value, action: 'reset', sequence: state.sequence + 1, paused: !interactive };
			started = false;
			ended = false;
			save();
			updatePlayback();
			send();
		});
		chrome.append(choices);
		inputs.push(...choices.querySelectorAll('input'));
	}
	const reduction = reducedMotionControl(state.reduced, value => {
		state = { ...state, reduced: value };
		save();
		send();
	}, signal);
	inputs.push(reduction.input);
	chrome.append(reduction.label, playback);
	setDisabled(true);
	viewer.append(host);
	if (showPlayback) { viewer.append(chrome); }
	card.append(viewer);
	appendCaption(card, caption);
	void renderFixturePreview(host, control, '', signal, () => { }, {
		id: `motion-preview-${id}`, heading: false, previewLabel: title, showVariants: false, pauseWhenHidden: true, actionsHost: source, contentSized: true, fillWidth: true, lazy: true,
		preferredTheme: model.previewTheme,
		mapVisibilityInput: (input, visible) => ({ ...input, motion: { ...input.motion, paused: input.motion.paused || !visible } }),
		input: { motion: state, enableAnimations: true },
		onMessage: data => {
			if (data.sequence !== state.sequence) { return; }
			if (data.type === 'vscode-motion-preview:started') {
				started = true;
				ended = false;
				const wasPaused = state.paused;
				state = { ...state, paused: false };
				updatePlayback();
				if (wasPaused && preview) { send(); }
			} else if (data.type === 'vscode-motion-preview:ended') {
				if (!started) { return; }
				started = false;
				ended = true;
				state = { ...state, paused: false };
				updatePlayback();
			}
		},
		onStatus: status => {
			ready = status === 'ready';
			setDisabled(!ready || !preview);
		},
	}).then(controller => {
		preview = controller;
		setDisabled(!ready || !preview);
	});
	if (!bare) { parent.append(card); }
}
