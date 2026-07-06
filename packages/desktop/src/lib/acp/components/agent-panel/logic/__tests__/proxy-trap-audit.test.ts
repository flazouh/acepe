import { describe, expect, it } from "vitest";

type PropValue = string | number | boolean | null | (() => void);
type PropBag = Record<string, PropValue>;
type PropSource = PropBag | (() => PropBag);
const restPropsSymbol = Symbol("restProps");
const restExcludeSymbol = Symbol("restExclude");
const spreadSourcesSymbol = Symbol("spreadSources");

type RestTarget = PropBag & {
	readonly [restPropsSymbol]: PropBag;
	readonly [restExcludeSymbol]: ReadonlySet<string>;
};

type SpreadTarget = PropBag & {
	readonly [spreadSourcesSymbol]: readonly PropSource[];
};

type TrapCounts = {
	get: number;
	has: number;
	getOwnPropertyDescriptor: number;
	ownKeys: number;
};

function createTrapCounts(): TrapCounts {
	return {
		get: 0,
		has: 0,
		getOwnPropertyDescriptor: 0,
		ownKeys: 0,
	};
}

function resetTrapCounts(counts: TrapCounts): void {
	counts.get = 0;
	counts.has = 0;
	counts.getOwnPropertyDescriptor = 0;
	counts.ownKeys = 0;
}

function totalTrapCount(counts: TrapCounts): number {
	return counts.get + counts.has + counts.getOwnPropertyDescriptor + counts.ownKeys;
}

function createProps(size: number): PropBag {
	const props: PropBag = {};
	for (let index = 0; index < size; index += 1) {
		props[`data-prop-${String(index)}`] = `value-${String(index)}`;
	}
	props.class = "base";
	props.role = "group";
	return props;
}

function resolvePropSource(source: PropSource): PropBag {
	return typeof source === "function" ? source() : source;
}

function createRestProps(
	props: PropBag,
	exclude: ReadonlySet<string>,
	counts: TrapCounts
): PropBag {
	const target: RestTarget = {
		[restPropsSymbol]: props,
		[restExcludeSymbol]: exclude,
	};
	return new Proxy(target, {
		get(target, key) {
			counts.get += 1;
			if (typeof key !== "string" || target[restExcludeSymbol].has(key)) {
				return undefined;
			}
			return target[restPropsSymbol][key];
		},
		has(target, key) {
			counts.has += 1;
			if (typeof key !== "string" || target[restExcludeSymbol].has(key)) {
				return false;
			}
			return key in target[restPropsSymbol];
		},
		getOwnPropertyDescriptor(target, key) {
			counts.getOwnPropertyDescriptor += 1;
			if (typeof key !== "string" || target[restExcludeSymbol].has(key)) {
				return undefined;
			}
			if (!(key in target[restPropsSymbol])) {
				return undefined;
			}
			return {
				configurable: true,
				enumerable: true,
				value: target[restPropsSymbol][key],
				writable: false,
			};
		},
		ownKeys(target) {
			counts.ownKeys += 1;
			return Reflect.ownKeys(target[restPropsSymbol]).filter(
				(key) => typeof key !== "string" || !target[restExcludeSymbol].has(key)
			);
		},
	});
}

function createSpreadProps(sources: readonly PropSource[], counts: TrapCounts): PropBag {
	const target: SpreadTarget = {
		[spreadSourcesSymbol]: sources,
	};
	return new Proxy(target, {
		get(target, key) {
			counts.get += 1;
			if (typeof key !== "string") {
				return undefined;
			}
			for (let index = target[spreadSourcesSymbol].length - 1; index >= 0; index -= 1) {
				const source = resolvePropSource(target[spreadSourcesSymbol][index]);
				if (key in source) {
					return source[key];
				}
			}
			return undefined;
		},
		has(target, key) {
			counts.has += 1;
			if (typeof key !== "string") {
				return false;
			}
			for (const sourceFactory of target[spreadSourcesSymbol]) {
				const source = resolvePropSource(sourceFactory);
				if (key in source) {
					return true;
				}
			}
			return false;
		},
		getOwnPropertyDescriptor(target, key) {
			counts.getOwnPropertyDescriptor += 1;
			if (typeof key !== "string") {
				return undefined;
			}
			for (let index = target[spreadSourcesSymbol].length - 1; index >= 0; index -= 1) {
				const source = resolvePropSource(target[spreadSourcesSymbol][index]);
				if (key in source) {
					return Object.getOwnPropertyDescriptor(source, key);
				}
			}
			return undefined;
		},
		ownKeys(target) {
			counts.ownKeys += 1;
			const keys: string[] = [];
			for (const sourceFactory of target[spreadSourcesSymbol]) {
				const source = resolvePropSource(sourceFactory);
				for (const key in source) {
					if (!keys.includes(key)) {
						keys.push(key);
					}
				}
			}
			return keys;
		},
	});
}

function flattenAttributes(props: PropBag): PropBag {
	const flattened: PropBag = {};
	for (const key of Reflect.ownKeys(props)) {
		if (typeof key !== "string") {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(props, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			continue;
		}
		flattened[key] = descriptor.value as PropValue;
	}
	return flattened;
}

function createNestedSveltePropShape(counts: TrapCounts): PropBag {
	const baseProps = createProps(24);
	const buttonRestProps = createRestProps(baseProps, new Set(["children"]), counts);
	const buttonSpreadProps = createSpreadProps(
		[buttonRestProps, { class: "button", type: "button" }],
		counts
	);
	const triggerRestProps = createRestProps(buttonSpreadProps, new Set(["child"]), counts);
	return createSpreadProps(
		[
			triggerRestProps,
			() => ({
				class: "trigger",
				"aria-expanded": false,
			}),
		],
		counts
	);
}

function createLazySceneArray(length: number, counts: TrapCounts): readonly number[] {
	const source = Array.from({ length }, (_item, index) => index);
	const target = new Array<number>(length);
	return new Proxy(target, {
		get(targetArray, key, receiver) {
			counts.get += 1;
			if (typeof key === "string") {
				const index = Number(key);
				if (Number.isInteger(index) && index >= 0 && String(index) === key) {
					return source[index];
				}
				if (key === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			return Reflect.get(targetArray, key, receiver);
		},
		has(targetArray, key) {
			counts.has += 1;
			if (typeof key === "string") {
				const index = Number(key);
				if (Number.isInteger(index) && index >= 0 && String(index) === key) {
					return index < targetArray.length;
				}
			}
			return key in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, key) {
			counts.getOwnPropertyDescriptor += 1;
			if (typeof key === "string") {
				const index = Number(key);
				if (Number.isInteger(index) && index >= 0 && index < targetArray.length) {
					return {
						configurable: true,
						enumerable: true,
						value: source[index],
						writable: false,
					};
				}
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, key);
		},
		ownKeys(targetArray) {
			counts.ownKeys += 1;
			return Reflect.ownKeys(targetArray);
		},
	});
}

describe("agent panel proxy trap audit", () => {
	it("reproduces descriptor churn from timer-style flattening of nested rest/spread props", () => {
		const counts = createTrapCounts();
		const nestedProps = createNestedSveltePropShape(counts);

		for (let tick = 0; tick < 60; tick += 1) {
			const flattened = flattenAttributes(nestedProps);
			expect(flattened.class).toBe("trigger");
		}

		expect(counts.getOwnPropertyDescriptor).toBeGreaterThan(1_000);
		expect(counts.ownKeys).toBeGreaterThan(100);
	});

	it("shows a materialized prop bag avoids repeated proxy traps across timer ticks", () => {
		const counts = createTrapCounts();
		const nestedProps = createNestedSveltePropShape(counts);
		const materializedProps = flattenAttributes(nestedProps);
		resetTrapCounts(counts);

		for (let tick = 0; tick < 60; tick += 1) {
			const flattened = flattenAttributes(materializedProps);
			expect(flattened.class).toBe("trigger");
		}

		expect(totalTrapCount(counts)).toBe(0);
	});

	it("rules out lazy scene-array slice as the descriptor-shaped hotspot", () => {
		const counts = createTrapCounts();
		const sceneEntries = createLazySceneArray(2_000, counts);

		for (let tick = 0; tick < 20; tick += 1) {
			expect(sceneEntries.slice(0, 50)).toHaveLength(50);
		}

		expect(counts.has).toBeGreaterThan(500);
		expect(counts.get).toBeGreaterThan(500);
		expect(counts.getOwnPropertyDescriptor).toBe(0);
	});
});
