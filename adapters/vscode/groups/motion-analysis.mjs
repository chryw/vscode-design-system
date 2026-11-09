/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable local/code-no-new-javascript-files -- Fixed no-build canvas modules execute directly in Node or the browser. */

const keywords = {
	linear: [0, 0, 1, 1],
	ease: [0.25, 0.1, 0.25, 1],
	'ease-in': [0.42, 0, 1, 1],
	'ease-out': [0, 0, 0.58, 1],
	'ease-in-out': [0.42, 0, 0.58, 1],
};
const cssNumber = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i;
const tolerance = 1e-12;

function parseEasing(easingCss) {
	if (typeof easingCss !== 'string' || !easingCss.trim()) {
		return { status: 'invalid', reason: 'Expected a nonempty CSS timing function.' };
	}
	const text = easingCss.trim().toLowerCase();
	if (Object.hasOwn(keywords, text)) {
		return { points: keywords[text] };
	}
	const match = /^cubic-bezier\((?<values>[^()]*)\)$/.exec(text);
	if (match) {
		const values = match.groups.values.split(',').map(value => value.trim());
		const points = values.map(Number);
		if (values.length !== 4 || !values.every(value => cssNumber.test(value)) || !points.every(Number.isFinite)
			|| points[0] < 0 || points[0] > 1 || points[2] < 0 || points[2] > 1) {
			return { status: 'invalid', reason: 'Cubic Bézier control points must be finite CSS numbers, with x coordinates in [0, 1].' };
		}
		return { points };
	}
	const reason = /^(?:steps\(|step-start$|step-end$)/.test(text)
		? 'Steps are discontinuous; continuous speed analysis does not apply.'
		: /^linear\(/.test(text)
			? 'Piecewise linear() timing is not supported by this cubic Bézier analysis.'
			: 'Resolve the timing function to linear, an easing keyword, or cubic-bezier() before analysis.';
	return { status: 'unsupported', reason };
}

function coordinate(first, second, parameter) {
	const inverse = 1 - parameter;
	return 3 * first * parameter * inverse * inverse + 3 * second * parameter * parameter * inverse + parameter ** 3;
}

function derivativeCoefficients(first, second) {
	return [3 * first, 6 * (second - 2 * first), 3 * (1 + 3 * first - 3 * second)];
}

function polynomial([constant, linear, quadratic], parameter) {
	return (quadratic * parameter + linear) * parameter + constant;
}

/** Stable quadratic roots avoid cancelling the smaller root when the linear term dominates. */
function roots([constant, linear, quadratic]) {
	const scale = Math.max(Math.abs(constant), Math.abs(linear), Math.abs(quadratic));
	if (scale === 0) { return []; }
	const [c, b, a] = [constant, linear, quadratic].map(value => value / scale);
	if (a === 0) { return b === 0 ? [] : [-c / b]; }
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) { return []; }
	const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant)) / 2;
	return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

function withinUnit(values) {
	return [...new Set(values.filter(value => value > 0 && value < 1))].sort((a, b) => a - b);
}

/** Invert each monotonic piece, including overshooting curves; never confuse Bézier parameter with elapsed time. */
function crossings(valueAt, boundaries, target) {
	const result = [];
	for (let index = 1; index < boundaries.length; index++) {
		let left = boundaries[index - 1];
		let right = boundaries[index];
		const start = valueAt(left);
		const end = valueAt(right);
		if (target < Math.min(start, end) || target > Math.max(start, end)) { continue; }
		if (target === start) { result.push(left); continue; }
		if (target === end) { result.push(right); continue; }
		for (let iteration = 0; iteration < 64; iteration++) {
			const middle = (left + right) / 2;
			if ((valueAt(middle) < target) === (start < end)) {
				left = middle;
			} else {
				right = middle;
			}
		}
		result.push((left + right) / 2);
	}
	return result;
}

/** The first nonzero powers give the one-sided dy/dx limit, including removable 0/0 endpoints. */
function endpointSlope(xFirst, xSecond, yFirst, ySecond) {
	const x = derivativeCoefficients(xFirst, xSecond);
	const y = derivativeCoefficients(yFirst, ySecond);
	const xOrder = x.findIndex(value => value !== 0);
	const yOrder = y.findIndex(value => value !== 0);
	if (yOrder < xOrder) { return null; }
	return yOrder > xOrder ? 0 : Math.abs(y[yOrder] / x[xOrder]);
}

function finiteSpeed(value) {
	return { status: 'finite', value };
}

/** Analyze one uninterrupted 0→1 timing function, independent of pixels, delay, frame rate, and property clamping.
 * Times use the first 50% crossing and the final entry into [0.98, 1.02]; speeds are absolute fractions of endpoint travel per second.
 */
export function analyzeMotionTiming(durationMs, easingCss) {
	if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
		return { status: 'invalid', reason: 'Duration must be a finite, nonnegative number of milliseconds.' };
	}
	const parsed = parseEasing(easingCss);
	if (!parsed.points) { return parsed; }
	const [xFirst, yFirst, xSecond, ySecond] = parsed.points;
	const base = { status: 'supported', durationMs: durationMs === 0 ? 0 : durationMs, easingCss };
	if (durationMs === 0) {
		return {
			...base, mode: 'instant', response50Ms: 0, settle2PercentMs: 0,
			speed: { unit: 'fraction/second', initial: { status: 'instantaneous' }, final: { status: 'instantaneous' }, peak: { status: 'instantaneous' } },
			overshoot: { aboveTarget: 0, belowStart: 0 }, monotonic: true,
		};
	}
	const xAt = parameter => coordinate(xFirst, xSecond, parameter);
	const yAt = parameter => coordinate(yFirst, ySecond, parameter);
	const xDerivative = derivativeCoefficients(xFirst, xSecond);
	const yDerivative = derivativeCoefficients(yFirst, ySecond);
	const [xc, xb, xa] = xDerivative;
	const [yc, yb, ya] = yDerivative;
	const speedExtrema = [yb * xc - yc * xb, 2 * (ya * xc - yc * xa), ya * xb - yb * xa];
	if (![...xDerivative, ...yDerivative, ...speedExtrema].every(Number.isFinite) || Math.max(Math.abs(yFirst), Math.abs(ySecond)) > 1e6) {
		return { status: 'unsupported', reason: 'Control points exceed the reliable numerical range of this analysis.' };
	}
	const extrema = [0, ...withinUnit(roots(yDerivative)), 1];
	const values = extrema.map(yAt);
	const monotonic = extrema.slice(1).every((end, index) => polynomial(yDerivative, (extrema[index] + end) / 2) >= 0);
	const response = Math.min(...crossings(yAt, extrema, 0.5));
	const bandBoundaries = [0, ...withinUnit([...crossings(yAt, extrema, 0.98), ...crossings(yAt, extrema, 1.02)]), 1];
	let settled = 0;
	for (let index = 1; index < bandBoundaries.length; index++) {
		const value = yAt((bandBoundaries[index - 1] + bandBoundaries[index]) / 2);
		if (value < 0.98 - tolerance || value > 1.02 + tolerance) {
			settled = bandBoundaries[index];
		}
	}

	const initial = endpointSlope(xFirst, xSecond, yFirst, ySecond);
	const final = endpointSlope(1 - xSecond, 1 - xFirst, 1 - ySecond, 1 - yFirst);
	const identity = xFirst === yFirst && xSecond === ySecond;
	// Only (1, 0) has an interior zero of dx/dt; only the identity curve cancels both powers there.
	const singularInterior = xFirst === 1 && xSecond === 0 && !identity;
	const unboundedAt = [
		...(initial === null ? ['start'] : []),
		...(singularInterior ? ['interior'] : []),
		...(final === null ? ['end'] : []),
	];
	const scaled = value => value / durationMs * 1000;
	const peak = unboundedAt.length ? null : Math.max(initial, final, ...withinUnit(roots(speedExtrema)).map(parameter =>
		identity ? 1 : Math.abs(polynomial(yDerivative, parameter) / polynomial(xDerivative, parameter))));
	const boundedValues = [response, settled, ...values, ...[initial, final, peak].filter(value => value !== null).map(scaled)];
	if (!boundedValues.every(Number.isFinite)) {
		return { status: 'unsupported', reason: 'Timing or speed exceeds the reliable numerical range of this analysis.' };
	}
	return {
		...base, mode: 'continuous',
		response50Ms: xAt(response) * durationMs,
		settle2PercentMs: xAt(settled) * durationMs,
		speed: {
			unit: 'fraction/second',
			initial: initial === null ? { status: 'unbounded' } : finiteSpeed(scaled(initial)),
			final: final === null ? { status: 'unbounded' } : finiteSpeed(scaled(final)),
			peak: unboundedAt.length ? { status: 'unbounded', at: unboundedAt } : finiteSpeed(scaled(peak)),
		},
		overshoot: { aboveTarget: Math.max(0, Math.max(...values) - 1), belowStart: Math.max(0, -Math.min(...values)) },
		monotonic,
	};
}
