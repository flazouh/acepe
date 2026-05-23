import type { SessionEntry } from "../../../application/dto/session-entry.js";
import type { ErrorMessage } from "../../../types/error-message.js";

interface ResolveVisibleSessionEntriesInput {
	readonly sessionEntries: readonly SessionEntry[];
	readonly activeTurnError: ErrorMessage | null;
}

function optionalFieldMatches<T>(left: T | undefined, right: T | undefined): boolean {
	return left === undefined || right === undefined || left === right;
}

function matchesErrorMessage(left: ErrorMessage, right: ErrorMessage): boolean {
	return (
		left.content === right.content &&
		optionalFieldMatches(left.code, right.code) &&
		optionalFieldMatches(left.kind, right.kind) &&
		optionalFieldMatches(left.source, right.source)
	);
}

export function resolveVisibleSessionEntries(
	input: ResolveVisibleSessionEntriesInput
): readonly SessionEntry[] {
	if (input.activeTurnError === null) {
		return input.sessionEntries;
	}

	const lastEntry = input.sessionEntries.at(-1);
	if (lastEntry?.type !== "error") {
		return input.sessionEntries;
	}

	if (!matchesErrorMessage(lastEntry.message, input.activeTurnError)) {
		return input.sessionEntries;
	}

	return createTruncatedSessionEntriesView(input.sessionEntries, input.sessionEntries.length - 1);
}

function createTruncatedSessionEntriesView(
	sessionEntries: readonly SessionEntry[],
	length: number
): readonly SessionEntry[] {
	const target = new Array<SessionEntry>(length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield sessionEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return sessionEntries[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: sessionEntries[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			const keys: string[] = [];
			for (let index = 0; index < targetArray.length; index += 1) {
				keys.push(String(index));
			}
			keys.push("length");
			return keys;
		},
	});
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}
