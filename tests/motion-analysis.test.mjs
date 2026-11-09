/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMotionTiming } from '../adapters/vscode/groups/motion-analysis.mjs';
import { projectMotionDefinitions } from '../adapters/vscode/groups/motion-source.mjs';

function close(actual, expected, label = '') {
	assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
}

function summary(result) {
	return {
		status: result.status, mode: result.mode, response: result.response50Ms, settle: result.settle2PercentMs,
		speed: result.speed, overshoot: result.overshoot, monotonic: result.monotonic,
	};
}

test('linear and identity Béziers agree, including removable endpoint and interior singularities', () => {
	const expected = {
		status: 'supported', mode: 'continuous', response: 100, settle: 196,
		speed: { unit: 'fraction/second', initial: { status: 'finite', value: 5 }, final: { status: 'finite', value: 5 }, peak: { status: 'finite', value: 5 } },
		overshoot: { aboveTarget: 0, belowStart: 0 }, monotonic: true,
	};
	for (const easing of ['linear', 'cubic-bezier(0, 0, 1, 1)', 'cubic-bezier(0, 0, 0, 0)', 'cubic-bezier(1, 1, 1, 1)', 'cubic-bezier(1, 1, 0, 0)']) {
		const result = summary(analyzeMotionTiming(200, easing));
		close(result.response, expected.response, easing);
		close(result.settle, expected.settle, easing);
		assert.deepEqual({ ...result, response: 100, settle: 196 }, expected);
	}
});

test('quadratic easing has analytically known response, settling, and speed', () => {
	const duration = 400;
	for (const [easing, response, settle, initial, final] of [
		['cubic-bezier(0.3333333333333333, 0, 0.6666666666666666, 0.3333333333333333)', Math.sqrt(0.5), Math.sqrt(0.98), 0, 5],
		['cubic-bezier(0.3333333333333333, 0.6666666666666666, 0.6666666666666666, 1)', 1 - Math.sqrt(0.5), 1 - Math.sqrt(0.02), 5, 0],
	]) {
		const result = analyzeMotionTiming(duration, easing);
		for (const [actual, expected] of [
			[result.response50Ms, duration * response], [result.settle2PercentMs, duration * settle],
			[result.speed.initial.value, initial], [result.speed.final.value, final], [result.speed.peak.value, 5],
		]) { close(actual, expected, easing); }
	}
});

test('CSS ease-in/out invert elapsed x, not the Bézier parameter or the y value at half duration', () => {
	const enter = analyzeMotionTiming(1000, 'ease-in');
	const exit = analyzeMotionTiming(1000, 'ease-out');
	close(enter.response50Ms, 657.5);
	close(exit.response50Ms, 342.5);
	close(enter.speed.final.value, 1 / 0.58);
	close(exit.speed.initial.value, 1 / 0.58);
	assert.deepEqual([enter.speed.initial, exit.speed.final], [{ status: 'finite', value: 0 }, { status: 'finite', value: 0 }]);
});

test('speed extrema are analytical, including a peak between two stationary endpoints', () => {
	const result = analyzeMotionTiming(200, 'cubic-bezier(0.3333333333333333, 0, 0.6666666666666666, 1)');
	close(result.response50Ms, 100);
	assert.deepEqual(result.speed, {
		unit: 'fraction/second',
		initial: { status: 'finite', value: 0 }, final: { status: 'finite', value: 0 }, peak: { status: 'finite', value: 7.5 },
	});
});

test('singular speed is explicit, never a finite sampled peak', () => {
	for (const [easing, locations] of [
		['cubic-bezier(0, 0.5, 0.5, 1)', ['start']],
		['cubic-bezier(0, 0, 0, 1)', ['start']],
		['cubic-bezier(0.5, 0, 1, 0.5)', ['end']],
		['cubic-bezier(1, 0, 1, 1)', ['end']],
		['cubic-bezier(0, 0.5, 1, 0.5)', ['start', 'end']],
		['cubic-bezier(1, 0, 0, 1)', ['interior']],
		['cubic-bezier(1, 2, 0, 1)', ['interior']],
	]) {
		const result = analyzeMotionTiming(1000, easing);
		assert.deepEqual(result.speed.peak, { status: 'unbounded', at: locations }, easing);
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
	}
});

test('overshoot and undershoot use extrema, and settling is the last band entry, not the first 98% crossing', () => {
	const result = analyzeMotionTiming(1000, 'cubic-bezier(0.3333333333333333, 2, 0.6666666666666666, 2)');
	const below = analyzeMotionTiming(1000, 'cubic-bezier(0.3333333333333333, -1, 0.6666666666666666, -1)');
	const valueAt = time => 6 * time - 6 * time * time + time ** 3;
	close(result.overshoot.aboveTarget, 4 * Math.SQRT2 - 5);
	close(below.overshoot.belowStart, result.overshoot.aboveTarget);
	close(valueAt(result.response50Ms / 1000), 0.5);
	close(valueAt(result.settle2PercentMs / 1000), 1.02);
	assert.ok(result.settle2PercentMs / 1000 > 2 - Math.SQRT2);
	assert.deepEqual([result.monotonic, below.monotonic, result.overshoot.belowStart, below.overshoot.aboveTarget], [false, false, 0, 0]);
});

test('touching the upper settling boundary without leaving it does not postpone settling', () => {
	const result = analyzeMotionTiming(1000, 'cubic-bezier(0.3333333333333333, 1.1866666666666668, 0.6666666666666666, 1.0222222222222221)');
	close(result.overshoot.aboveTarget, 0.02);
	assert.ok(result.settle2PercentMs < 750, 'the curve is already in the band before its tangent at 750ms');
});

test('keywords, CSS number forms, and duration changes retain the same normalized shape', () => {
	for (const [keyword, curve] of [
		['ease', 'cubic-bezier(.25, .1, .25, 1)'],
		['ease-in', 'cubic-bezier(.42, 0, 1, 1)'],
		['ease-out', 'cubic-bezier(0, 0, .58, 1)'],
		['ease-in-out', 'cubic-bezier(.42, 0, .58, 1)'],
	]) {
		const original = analyzeMotionTiming(200, keyword);
		const changed = analyzeMotionTiming(400, curve);
		close(changed.response50Ms, original.response50Ms * 2);
		close(changed.settle2PercentMs, original.settle2PercentMs * 2);
		close(changed.speed.peak.value, original.speed.peak.value / 2);
	}
	assert.deepEqual(summary(analyzeMotionTiming(100, ' CUBIC-BEZIER(+2.5e-1, 1E-1, .25, 1) ')), summary(analyzeMotionTiming(100, 'ease')));
});

test('analysis accepts source-projected aliases without owning a parallel catalog of defaults', () => {
	const project = (duration, easing) => projectMotionDefinitions([
		{ id: 'motion.duration.test', kind: 'duration', value: duration },
		{ id: 'motion.control.duration', kind: 'duration', value: { ref: 'motion.duration.test' } },
		{ id: 'motion.control.easing', kind: 'easing', value: easing },
	], [{
		id: 'motion.control', duration: 'motion.control.duration', easing: 'motion.control.easing', frames: [],
	}]).recipes[0];
	const before = project(200, 'linear');
	const after = project(400, [0.42, 0, 1, 1]);
	assert.deepEqual([before, after].map(recipe => {
		const result = analyzeMotionTiming(recipe.duration, recipe.easing);
		return [result.durationMs, result.response50Ms, result.monotonic];
	}), [[200, 100, true], [400, 263, true]]);
});

test('zero duration is an immediate state change, not a continuous motion with zero or infinite sampled speed', () => {
	assert.deepEqual(summary(analyzeMotionTiming(0, 'ease')), {
		status: 'supported', mode: 'instant', response: 0, settle: 0,
		speed: { unit: 'fraction/second', initial: { status: 'instantaneous' }, final: { status: 'instantaneous' }, peak: { status: 'instantaneous' } },
		overshoot: { aboveTarget: 0, belowStart: 0 }, monotonic: true,
	});
});

test('invalid values and unsupported timing functions cannot masquerade as successful measurements', () => {
	const inputs = [
		...[-1, NaN, Infinity, -Infinity, '100', null].map(duration => [duration, 'linear', 'invalid']),
		...[null, '', 'cubic-bezier(-0.1, 0, 1, 1)', 'cubic-bezier(0, 0, 1.1, 1)', 'cubic-bezier(0, Infinity, 1, 1)', 'cubic-bezier(0, 1e400, 1, 1)', 'cubic-bezier(0, 0, 1)', 'cubic-bezier(0, 0, 1, 1px)'].map(easing => [100, easing, 'invalid']),
		...['steps(4)', 'step-start', 'step-end', 'linear(0, 0.5 40%, 1)', 'var(--easing)', 'spring(1, 2, 3)', 'inherit'].map(easing => [100, easing, 'unsupported']),
		[0, 'steps(4)', 'unsupported'],
		[Number.MIN_VALUE, 'linear', 'unsupported'],
		[1000, 'cubic-bezier(5e-324, 1, 1, 1)', 'unsupported'],
		[100, 'cubic-bezier(0, 1e100, 1, 1)', 'unsupported'],
	];
	for (const [duration, easing, status] of inputs) {
		const result = analyzeMotionTiming(duration, easing);
		assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
		assert.equal(result.status, status, `${duration}, ${easing}`);
		assert.equal(typeof result.reason, 'string');
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
	}
});
