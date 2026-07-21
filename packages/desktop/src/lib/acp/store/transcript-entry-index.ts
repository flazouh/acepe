/**
 * Transcript-entry index + patch helpers for the session store: maintain the
 * entryId→index map for a transcript snapshot, and produce lazy patched/appended
 * transcript-entry arrays (replace an entry, append a streaming segment) tagged
 * with their array-patch shape. Pure transcript-snapshot transforms — no
 * projection state, no order repair. GOD-safe.
 */
import type { TranscriptEntry } from "../../services/acp-types.js";
import { markTranscriptEntryArrayPatch } from "../session-state/transcript-entry-array-patch.js";
import { toArrayIndex } from "./array-index-utils.js";

export const transcriptEntryIndexes = new WeakMap<
	readonly TranscriptEntry[],
	ReadonlyMap<string, number>
>();

export function getTranscriptEntryIndex(
	entries: readonly TranscriptEntry[]
): ReadonlyMap<string, number> {
	const existing = transcriptEntryIndexes.get(entries);
	if (existing !== undefined) {
		return existing;
	}

	const next = new Map<string, number>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined && !next.has(entry.entryId)) {
			next.set(entry.entryId, index);
		}
	}
	transcriptEntryIndexes.set(entries, next);
	return next;
}

export function seedTranscriptEntryIndex(entries: readonly TranscriptEntry[]): void {
	if (transcriptEntryIndexes.has(entries)) {
		return;
	}
	getTranscriptEntryIndex(entries);
}

export function replaceTranscriptEntry(
	entries: readonly TranscriptEntry[],
	nextEntry: TranscriptEntry
): TranscriptEntry[] {
	const currentIndex = getTranscriptEntryIndex(entries);
	const index = currentIndex.get(nextEntry.entryId);
	if (index === undefined) {
		const nextEntries = createPatchedTranscriptEntryArray(entries, null, [nextEntry]);
		transcriptEntryIndexes.set(
			nextEntries,
			new AppendedTranscriptEntryIndexMap(currentIndex, [nextEntry], entries.length)
		);
		return nextEntries;
	}

	if (entries[index] === nextEntry) {
		return entries as TranscriptEntry[];
	}

	const nextEntries = createPatchedTranscriptEntryArray(
		entries,
		new Map([[index, nextEntry]]),
		null
	);
	transcriptEntryIndexes.set(nextEntries, currentIndex);
	return nextEntries;
}

export function appendTranscriptSegment(
	entries: readonly TranscriptEntry[],
	entryId: string,
	role: TranscriptEntry["role"],
	segment: TranscriptEntry["segments"][number]
): TranscriptEntry[] {
	const currentIndex = getTranscriptEntryIndex(entries);
	const index = currentIndex.get(entryId);
	if (index === undefined) {
		const nextEntry = {
			entryId,
			role,
			segments: [segment],
		};
		const nextEntries = createPatchedTranscriptEntryArray(entries, null, [nextEntry]);
		transcriptEntryIndexes.set(
			nextEntries,
			new AppendedTranscriptEntryIndexMap(currentIndex, [nextEntry], entries.length)
		);
		return nextEntries;
	}

	if (entries[index]?.role !== role) {
		const nextEntry = {
			entryId,
			role,
			segments: [segment],
		};
		const nextEntries = createPatchedTranscriptEntryArray(entries, null, [nextEntry]);
		transcriptEntryIndexes.set(
			nextEntries,
			new AppendedTranscriptEntryIndexMap(currentIndex, [nextEntry], entries.length)
		);
		return nextEntries;
	}

	const entry = entries[index];
	if (entry === undefined) {
		return entries as TranscriptEntry[];
	}
	const nextEntries = createPatchedTranscriptEntryArray(
		entries,
		new Map([
			[
				index,
				{
					entryId: entry.entryId,
					role: entry.role,
					segments: entry.segments.concat([segment]),
				},
			],
		]),
		null
	);
	transcriptEntryIndexes.set(nextEntries, currentIndex);
	return nextEntries;
}

class AppendedTranscriptEntryIndexMap implements ReadonlyMap<string, number> {
	readonly [Symbol.toStringTag] = "AppendedTranscriptEntryIndexMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly appendedEntries: readonly TranscriptEntry[],
		private readonly baseLength: number
	) {}

	get size(): number {
		let appendedCount = 0;
		for (const entry of this.appendedEntries) {
			if (entry !== undefined && !this.base.has(entry.entryId)) {
				appendedCount += 1;
			}
		}
		return this.base.size + appendedCount;
	}

	get(key: string): number | undefined {
		for (let index = 0; index < this.appendedEntries.length; index += 1) {
			const entry = this.appendedEntries[index];
			if (entry?.entryId === key) {
				return this.baseLength + index;
			}
		}
		return this.base.get(key);
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		const appendedKeys = new Set<string>();
		for (let index = 0; index < this.appendedEntries.length; index += 1) {
			const entry = this.appendedEntries[index];
			if (entry !== undefined) {
				appendedKeys.add(entry.entryId);
			}
		}
		for (const [key, value] of this.base.entries()) {
			if (!appendedKeys.has(key)) {
				yield [key, value];
			}
		}
		for (let index = 0; index < this.appendedEntries.length; index += 1) {
			const entry = this.appendedEntries[index];
			if (entry !== undefined) {
				yield [entry.entryId, this.baseLength + index];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

export function createPatchedTranscriptEntryArray(
	base: readonly TranscriptEntry[],
	patchedIndexes: ReadonlyMap<number, TranscriptEntry> | null,
	appendedEntries: readonly TranscriptEntry[] | null
): TranscriptEntry[] {
	const appended = appendedEntries ?? [];
	const target = new Array<TranscriptEntry>(base.length + appended.length);
	const entries = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPatchedTranscriptEntry(base, patchedIndexes, appended, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPatchedTranscriptEntry(base, patchedIndexes, appended, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
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
					value: selectPatchedTranscriptEntry(base, patchedIndexes, appended, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	markTranscriptEntryArrayPatch(entries, {
		baseEntries: base,
		patchedEntriesByIndex: patchedIndexes,
		appendedEntries,
	});
	return entries;
}

export function selectPatchedTranscriptEntry(
	base: readonly TranscriptEntry[],
	patchedIndexes: ReadonlyMap<number, TranscriptEntry> | null,
	appended: readonly TranscriptEntry[],
	index: number
): TranscriptEntry | undefined {
	if (index < base.length) {
		return patchedIndexes?.get(index) ?? base[index];
	}
	return appended[index - base.length];
}
