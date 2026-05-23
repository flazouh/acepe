/**
 * Session Entry Store - Manages conversation entries with synchronous mutations.
 *
 * Handles:
 * - Entry storage and retrieval (IEntryStoreInternal)
 * - Synchronous entry mutations for immediate UI updates
 *
 * Delegates to extracted managers:
 * - EntryIndexManager: O(1) entryId and toolCallId lookups
 *
 * Note: This file uses native Map/Set/Date for internal indexes and timestamps
 * that are NOT meant to be reactive. Only entriesById uses SvelteMap for
 * fine-grained reactivity.
 */

import { SvelteMap } from "svelte/reactivity";
import type { TranscriptDelta, TranscriptSnapshot } from "../../services/acp-types.js";
import { createLogger } from "../utils/logger.js";
import { OperationStore } from "./operation-store.svelte.js";
import { EntryIndexManager } from "./services/entry-index-manager";
import type { IEntryStoreInternal, ToolCallEntryRef } from "./services/interfaces/entry-store-internal.js";
import type { IEntryManager } from "./services/interfaces/index.js";
import { normalizeToolResult } from "./services/tool-result-normalizer.js";
import {
	appendTranscriptSegmentToSessionEntry,
	convertTranscriptEntryToSessionEntry,
	convertTranscriptSnapshotToSessionEntries,
} from "./services/transcript-snapshot-entry-adapter.js";
import type { SessionEntry } from "./types.js";
import { isToolCallEntry, toolCallIdFromEntry } from "./types.js";

const logger = createLogger({ id: "session-entry-store", name: "SessionEntryStore" });

/**
 * Store for managing session entries with O(1) chunk aggregation.
 * Implements IEntryManager for external consumers and IEntryStoreInternal
 * for extracted services (TranscriptToolCallBuffer) to read/write entries.
 *
 * Uses SvelteMap for fine-grained reactivity: when session A's entries change,
 * only components reading session A re-render, not components reading session B.
 */
export class SessionEntryStore implements IEntryManager, IEntryStoreInternal {
	private readonly operationStore: OperationStore;

	// Entries stored with SvelteMap for fine-grained per-session reactivity
	// Only components reading a specific session re-render when that session changes
	private entriesById = new SvelteMap<string, SessionEntry[]>();

	// Extracted index manager for O(1) entryId and toolCallId lookups
	private readonly entryIndex = new EntryIndexManager();

	// Track which sessions have been preloaded
	private preloadedIds = new Set<string>();
	private readonly transcriptRevisionBySession = new Map<string, number>();

	constructor(operationStore?: OperationStore) {
		this.operationStore = operationStore ?? new OperationStore();
	}

	// ============================================
	// IEntryStoreInternal (consumed by TranscriptToolCallBuffer)
	// ============================================

	/** Check if a session exists in committed or preloaded state. */
	hasSession(sessionId: string): boolean {
		return this.entriesById.has(sessionId) || this.preloadedIds.has(sessionId);
	}

	// ============================================
	// ENTRY ACCESS
	// ============================================

	findToolCallEntryRef(sessionId: string, toolCallId: string): ToolCallEntryRef | null {
		const entries = this.entriesById.get(sessionId) ?? [];
		const indexedPosition = this.entryIndex.getToolCallIdIndex(sessionId, toolCallId);
		if (indexedPosition !== undefined) {
			const indexedEntry = entries[indexedPosition];
			if (isToolCallEntry(indexedEntry) && toolCallIdFromEntry(indexedEntry) === toolCallId) {
				return { entry: indexedEntry, index: indexedPosition };
			}
		}

		const recoveredIndex = entries.findIndex(
			(entry) => isToolCallEntry(entry) && toolCallIdFromEntry(entry) === toolCallId
		);
		if (recoveredIndex === -1) {
			return null;
		}

		const recoveredEntry = entries[recoveredIndex];
		if (!isToolCallEntry(recoveredEntry)) {
			return null;
		}

		this.entryIndex.addToolCallId(sessionId, toolCallId, recoveredIndex);
		return { entry: recoveredEntry, index: recoveredIndex };
	}

	/**
	 * Check if a session has entries.
	 */
	hasEntries(sessionId: string): boolean {
		return this.entriesById.has(sessionId);
	}

	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean {
		return this.preloadedIds.has(sessionId);
	}

	getTranscriptRevision(sessionId: string): number | undefined {
		return this.transcriptRevisionBySession.get(sessionId);
	}

	// ============================================
	// ENTRY MUTATIONS
	// ============================================

	/**
	 * Preload projected SessionEntry rows for restored transcript state.
	 * Product transcript truth must use replaceTranscriptSnapshot/applyTranscriptDelta.
	 */
	private preloadEntriesAndBuildIndex(sessionId: string, entries: SessionEntry[]): void {
		const normalizedEntries = this.normalizePreloadedEntries(entries);
		this.setEntriesAndBuildIndices(sessionId, normalizedEntries);
		this.preloadedIds.add(sessionId);
	}

	private setEntriesAndBuildIndices(sessionId: string, entries: SessionEntry[]): void {
		// SvelteMap provides fine-grained reactivity - only this session's subscribers re-render
		this.entriesById.set(sessionId, entries);

		// Build indices for O(1) lookups
		this.entryIndex.rebuildEntryIdIndex(sessionId, entries);
		this.entryIndex.rebuildToolCallIdIndex(sessionId, entries);
		this.preloadedIds.add(sessionId);
	}

	replaceTranscriptSnapshot(
		sessionId: string,
		snapshot: TranscriptSnapshot,
		timestamp: Date
	): void {
		const entries = convertTranscriptSnapshotToSessionEntries(snapshot, timestamp);
		this.setEntriesAndBuildIndices(sessionId, entries);
		this.transcriptRevisionBySession.set(sessionId, snapshot.revision);
	}

	applyTranscriptDelta(sessionId: string, delta: TranscriptDelta, timestamp: Date): void {
		const currentRevision = this.transcriptRevisionBySession.get(sessionId);
		if (currentRevision !== undefined && delta.snapshotRevision <= currentRevision) {
			return;
		}

		if (delta.operations.length > 1) {
			this.applyTranscriptDeltaBatch(sessionId, delta, timestamp);
			return;
		}

		for (const operation of delta.operations) {
			if (operation.kind === "replaceSnapshot") {
				this.replaceTranscriptSnapshot(sessionId, operation.snapshot, timestamp);
				continue;
			}

			if (operation.kind === "appendEntry") {
				const existingIndex = this.entryIndex.getEntryIdIndex(sessionId, operation.entry.entryId);
				const convertedEntry = convertTranscriptEntryToSessionEntry(operation.entry, timestamp);
				if (existingIndex === undefined) {
					this.appendTranscriptEntry(sessionId, convertedEntry);
				} else {
					this.replaceTranscriptEntry(sessionId, existingIndex, convertedEntry);
				}
				continue;
			}

			const existingIndex = this.entryIndex.getEntryIdIndex(sessionId, operation.entryId);
			if (existingIndex === undefined) {
				const nextEntry = convertTranscriptEntryToSessionEntry(
					{
						entryId: operation.entryId,
						role: operation.role,
						segments: [operation.segment],
					},
					timestamp
				);
				this.appendTranscriptEntry(sessionId, nextEntry);
				continue;
			}

			const existingEntries = this.entriesById.get(sessionId) ?? [];
			const existingEntry = existingEntries[existingIndex];
			if (existingEntry === undefined) {
				continue;
			}
			const updatedEntry = appendTranscriptSegmentToSessionEntry(existingEntry, operation.segment);
			if (updatedEntry === null) {
				continue;
			}
			this.replaceTranscriptEntry(sessionId, existingIndex, updatedEntry);
		}

		this.transcriptRevisionBySession.set(sessionId, delta.snapshotRevision);
	}

	private applyTranscriptDeltaBatch(
		sessionId: string,
		delta: TranscriptDelta,
		timestamp: Date
	): void {
		let entries = this.entriesById.get(sessionId) ?? [];
		let patchedIndexes: Map<number, SessionEntry> | null = null;
		let appendedEntries: SessionEntry[] = [];
		const appendedEntryIndexes = new Map<string, number>();
		let replacedSnapshot = false;
		const changedEntryIndexes = new Map<
			number,
			{ previous: SessionEntry | undefined; next: SessionEntry }
		>();

		const resolveEntryIndex = (entryId: string): number | undefined => {
			return (
				appendedEntryIndexes.get(entryId) ??
				(replacedSnapshot ? undefined : this.entryIndex.getEntryIdIndex(sessionId, entryId))
			);
		};
		const readEntryAt = (index: number): SessionEntry | undefined => {
			if (index < entries.length) {
				return patchedIndexes?.get(index) ?? entries[index];
			}
			return appendedEntries[index - entries.length];
		};
		const writeEntryAt = (index: number, entry: SessionEntry): void => {
			if (index < entries.length) {
				patchedIndexes ??= new Map();
				patchedIndexes.set(index, entry);
				return;
			}
			appendedEntries[index - entries.length] = entry;
		};
		const recordChangedEntry = (
			index: number,
			previous: SessionEntry | undefined,
			next: SessionEntry
		): void => {
			changedEntryIndexes.set(index, { previous, next });
		};

		for (const operation of delta.operations) {
			if (operation.kind === "replaceSnapshot") {
				entries = convertTranscriptSnapshotToSessionEntries(operation.snapshot, timestamp).map(
					(entry) => this.normalizeRuntimeEntry(entry)
				);
				patchedIndexes = null;
				appendedEntries = [];
				appendedEntryIndexes.clear();
				entries.forEach((entry, index) => appendedEntryIndexes.set(entry.id, index));
				replacedSnapshot = true;
				changedEntryIndexes.clear();
				continue;
			}

			if (operation.kind === "appendEntry") {
				const convertedEntry = this.normalizeRuntimeEntry(
					convertTranscriptEntryToSessionEntry(operation.entry, timestamp)
				);
				const existingIndex = resolveEntryIndex(operation.entry.entryId);
				if (existingIndex === undefined) {
					const nextIndex = entries.length + appendedEntries.length;
					appendedEntryIndexes.set(operation.entry.entryId, nextIndex);
					appendedEntries.push(convertedEntry);
					recordChangedEntry(nextIndex, undefined, convertedEntry);
				} else {
					const previousEntry = readEntryAt(existingIndex);
					writeEntryAt(existingIndex, convertedEntry);
					recordChangedEntry(existingIndex, previousEntry, convertedEntry);
				}
				continue;
			}

			const existingIndex = resolveEntryIndex(operation.entryId);
			if (existingIndex === undefined) {
				const nextEntry = this.normalizeRuntimeEntry(
					convertTranscriptEntryToSessionEntry(
						{
							entryId: operation.entryId,
							role: operation.role,
							segments: [operation.segment],
						},
						timestamp
					)
				);
				const nextIndex = entries.length + appendedEntries.length;
				appendedEntryIndexes.set(operation.entryId, nextIndex);
				appendedEntries.push(nextEntry);
				recordChangedEntry(nextIndex, undefined, nextEntry);
				continue;
			}

			const existingEntry = readEntryAt(existingIndex);
			if (existingEntry === undefined) {
				continue;
			}
			const updatedEntry = appendTranscriptSegmentToSessionEntry(
				existingEntry,
				operation.segment
			);
			if (updatedEntry === null) {
				continue;
			}
			const normalizedEntry = this.normalizeRuntimeEntry(updatedEntry);
			writeEntryAt(existingIndex, normalizedEntry);
			recordChangedEntry(existingIndex, existingEntry, normalizedEntry);
		}

		if (replacedSnapshot) {
			this.entriesById.set(sessionId, entries);
			this.entryIndex.rebuildEntryIdIndex(sessionId, entries);
			this.entryIndex.rebuildToolCallIdIndex(sessionId, entries);
		} else if (patchedIndexes !== null || appendedEntries.length > 0) {
			const nextEntries = createPatchedSessionEntryArray(
				entries,
				patchedIndexes,
				appendedEntries.length === 0 ? null : appendedEntries
			);
			this.entriesById.set(sessionId, nextEntries);
			for (const [index, change] of changedEntryIndexes) {
				this.updateEntryIndexesForReplacement(sessionId, index, change.previous, change.next);
			}
		}
		this.transcriptRevisionBySession.set(sessionId, delta.snapshotRevision);
	}

	private updateEntryIndexesForReplacement(
		sessionId: string,
		index: number,
		previousEntry: SessionEntry | undefined,
		nextEntry: SessionEntry
	): void {
		if (previousEntry !== undefined && previousEntry.id !== nextEntry.id) {
			this.entryIndex.deleteEntryId(sessionId, previousEntry.id);
		}
		this.entryIndex.addEntryId(sessionId, nextEntry.id, index);

		const previousToolCallId =
			previousEntry !== undefined && isToolCallEntry(previousEntry)
				? toolCallIdFromEntry(previousEntry)
				: null;
		const nextToolCallId = isToolCallEntry(nextEntry) ? toolCallIdFromEntry(nextEntry) : null;
		if (previousToolCallId !== null && previousToolCallId !== nextToolCallId) {
			this.entryIndex.deleteToolCallId(sessionId, previousToolCallId);
		}
		if (nextToolCallId !== null) {
			this.entryIndex.addToolCallId(sessionId, nextToolCallId, index);
		}
	}

	private normalizeRuntimeEntry(entry: SessionEntry): SessionEntry {
		if (!isToolCallEntry(entry)) {
			return entry;
		}

		return {
			id: entry.id,
			type: entry.type,
			message: {
				id: toolCallIdFromEntry(entry),
				name: entry.message.name,
				arguments: entry.message.arguments,
				progressiveArguments: entry.message.progressiveArguments,
				status: entry.message.status,
				result: entry.message.result,
				kind: entry.message.kind,
				title: entry.message.title,
				locations: entry.message.locations,
				skillMeta: entry.message.skillMeta,
				normalizedQuestions: entry.message.normalizedQuestions,
				normalizedTodos: entry.message.normalizedTodos,
				parentToolUseId: entry.message.parentToolUseId,
				taskChildren: entry.message.taskChildren,
				questionAnswer: entry.message.questionAnswer,
				awaitingPlanApproval: entry.message.awaitingPlanApproval,
				planApprovalRequestId: entry.message.planApprovalRequestId,
				normalizedResult: normalizeToolResult(entry.message),
			},
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
		};
	}

	private normalizePreloadedEntries(entries: SessionEntry[]): SessionEntry[] {
		const normalizedEntries: SessionEntry[] = [];
		for (const entry of entries) {
			normalizedEntries.push(this.normalizeRuntimeEntry(entry));
		}
		return normalizedEntries;
	}

	/**
	 * Append a canonical transcript row.
	 */
	appendTranscriptEntry(sessionId: string, entry: SessionEntry): void {
		const normalizedEntry = this.normalizeRuntimeEntry(entry);
		const entries = this.entriesById.get(sessionId) ?? [];
		const newEntries = createPatchedSessionEntryArray(entries, null, [normalizedEntry]);
		this.entriesById.set(sessionId, newEntries);
		const newIndex = newEntries.length - 1;
		this.entryIndex.addEntryId(sessionId, normalizedEntry.id, newIndex);
		if (isToolCallEntry(normalizedEntry)) {
			this.entryIndex.addToolCallId(sessionId, toolCallIdFromEntry(normalizedEntry), newIndex);
		}
		logger.debug("appendTranscriptEntry: appended entry", {
			sessionId,
			entryId: normalizedEntry.id,
			entryType: normalizedEntry.type,
			entryCount: newEntries.length,
		});
	}

	/**
	 * Replace a canonical transcript row.
	 */
	replaceTranscriptEntry(sessionId: string, index: number, updatedEntry: SessionEntry): void {
		const entries = this.entriesById.get(sessionId);
		if (!entries || index < 0 || index >= entries.length) return;
		const previousEntry = entries[index];
		const normalizedEntry = this.normalizeRuntimeEntry(updatedEntry);
		const newEntries = createPatchedSessionEntryArray(
			entries,
			new Map([[index, normalizedEntry]]),
			null
		);
		this.entriesById.set(sessionId, newEntries);
		logger.debug("replaceTranscriptEntry: replaced entry", {
			sessionId,
			index,
			entryId: normalizedEntry.id,
			entryType: normalizedEntry.type,
			entryCount: newEntries.length,
		});

		if (previousEntry.id !== normalizedEntry.id) {
			this.entryIndex.deleteEntryId(sessionId, previousEntry.id);
		}
		this.entryIndex.addEntryId(sessionId, normalizedEntry.id, index);

		const previousToolCallId = isToolCallEntry(previousEntry)
			? toolCallIdFromEntry(previousEntry)
			: null;
		const updatedToolCallId = isToolCallEntry(normalizedEntry)
			? toolCallIdFromEntry(normalizedEntry)
			: null;
		if (previousToolCallId !== null && updatedToolCallId !== null) {
			if (previousToolCallId !== updatedToolCallId) {
				this.entryIndex.deleteToolCallId(sessionId, previousToolCallId);
			}
			this.entryIndex.addToolCallId(sessionId, updatedToolCallId, index);
		} else if (previousToolCallId !== null || updatedToolCallId !== null) {
			if (previousToolCallId !== null) {
				this.entryIndex.deleteToolCallId(sessionId, previousToolCallId);
			}
			if (updatedToolCallId !== null) {
				this.entryIndex.addToolCallId(sessionId, updatedToolCallId, index);
			}
		}
	}

	/**
	 * Clear entries for a session.
	 */
	clearEntries(sessionId: string): void {
		// SvelteMap: .delete() triggers fine-grained reactivity for this session only
		this.entriesById.delete(sessionId);

		this.entryIndex.clearSession(sessionId);
		this.preloadedIds.delete(sessionId);
		this.transcriptRevisionBySession.delete(sessionId);

		this.operationStore.clearSession(sessionId);
	}

	/**
	 * Mark all still-streaming tool call entries as not streaming.
	 * Called on turn completion so pending tools stop shimmering.
	 */
	finalizeStreamingEntries(sessionId: string): void {
		const entries = this.entriesById.get(sessionId);
		if (!entries) return;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type === "tool_call" && entry.isStreaming) {
				entries[i] = { ...entry, isStreaming: false };
			}
		}
	}
}

function createPatchedSessionEntryArray(
	base: readonly SessionEntry[],
	patchedIndexes: ReadonlyMap<number, SessionEntry> | null,
	appendedEntries: readonly SessionEntry[] | null
): SessionEntry[] {
	const appended = appendedEntries ?? [];
	const target = new Array<SessionEntry>(base.length + appended.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPatchedSessionEntry(base, patchedIndexes, appended, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPatchedSessionEntry(base, patchedIndexes, appended, index);
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
		ownKeys(targetArray) {
			const keys: string[] = [];
			for (let index = 0; index < targetArray.length; index += 1) {
				keys.push(String(index));
			}
			keys.push("length");
			return keys;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectPatchedSessionEntry(base, patchedIndexes, appended, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
}

function selectPatchedSessionEntry(
	base: readonly SessionEntry[],
	patchedIndexes: ReadonlyMap<number, SessionEntry> | null,
	appended: readonly SessionEntry[],
	index: number
): SessionEntry | undefined {
	if (index < base.length) {
		return patchedIndexes?.get(index) ?? base[index];
	}
	return appended[index - base.length];
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}
