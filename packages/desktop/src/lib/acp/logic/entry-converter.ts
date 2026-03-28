/**
 * Entry Converter - Converts Rust backend entries to frontend StoredEntry format.
 *
 * This module handles the transformation between backend (Rust) and frontend (TypeScript)
 * data formats, specifically:
 * - Renaming `input` to `arguments` for tool calls (backend uses `input`, frontend expects `arguments`)
 * - Parsing timestamp strings to Date objects
 * - Type-safe discriminated union handling
 *
 * Design Decisions:
 * - Uses explicit switch statement instead of nested ternaries for readability
 * - Separates tool call conversion into dedicated function for clarity
 * - Returns new objects (immutable transformation)
 * - Handles all edge cases for timestamp and input fields
 */

import type { StoredEntry } from "../infrastructure/storage/ThreadStorage.js";

const LEGACY_TOOL_NAME_LABELS: Record<string, string> = {
	Bash: "Run",
	Execute: "Run",
	Glob: "Find",
	Grep: "Search",
	WebSearch: "Web Search",
	TaskOutput: "Task Output",
	EnterPlanMode: "Plan",
	ExitPlanMode: "Plan",
	CreatePlan: "Create Plan",
	read_file: "Read",
	ReadFile: "Read",
	edit_file: "Edit",
	EditFile: "Edit",
	apply_patch: "Edit",
};

/**
 * User message from Rust backend.
 */
export interface RustStoredUserMessage {
	id?: string;
	content?: unknown;
	chunks?: unknown[];
	sentAt?: string;
}

/**
 * Assistant message from Rust backend.
 */
export interface RustStoredAssistantMessage {
	chunks?: unknown[];
	model?: string;
	receivedAt?: string;
}

/**
 * Tool call from Rust backend.
 * Note: Uses `input` field which needs to be renamed to `arguments` for frontend.
 */
export interface RustStoredToolCall {
	id: string;
	name: string;
	title?: string;
	status: string;
	result?: string;
	kind: string;
	input?: unknown;
}

/**
 * Entry types from Rust backend.
 * Discriminated union tagged by "type" field.
 */
export type RustStoredEntry =
	| {
			type: "user";
			id: string;
			message: RustStoredUserMessage;
			timestamp?: string;
	  }
	| {
			type: "assistant";
			id: string;
			message: RustStoredAssistantMessage;
			timestamp?: string;
	  }
	| {
			type: "tool_call";
			id: string;
			toolCall: RustStoredToolCall;
			timestamp?: string;
	  };

/**
 * Converted tool call for frontend.
 * Uses `arguments` instead of `input` to match ToolCallSchema.
 */
interface ConvertedToolCall {
	id: string;
	name: string;
	title?: string;
	status: string;
	result?: string;
	kind: string;
	arguments: Record<string, unknown>;
}

/**
 * Parse timestamp string to Date, with fallback to current time.
 *
 * @param timestamp - ISO timestamp string or undefined
 * @returns Date object
 */
function parseTimestamp(timestamp: string | undefined): Date {
	if (timestamp && timestamp.length > 0) {
		return new Date(timestamp);
	}
	return new Date();
}

function canonicalToolName(name: string): string {
	const label = LEGACY_TOOL_NAME_LABELS[name];
	return label ? label : name;
}

/**
 * Convert Rust tool call to frontend format.
 * Renames `input` to `arguments` for ToolCallSchema compatibility.
 *
 * @param rustToolCall - Tool call from Rust backend
 * @returns Converted tool call with `arguments` field
 */
function convertToolCall(rustToolCall: RustStoredToolCall): ConvertedToolCall {
	// Extract input and rename to arguments
	// Handle undefined, null, and missing input gracefully
	const args = (rustToolCall.input ?? {}) as Record<string, unknown>;

	return {
		id: rustToolCall.id,
		name: canonicalToolName(rustToolCall.name),
		title: rustToolCall.title,
		status: rustToolCall.status,
		result: rustToolCall.result,
		kind: rustToolCall.kind,
		arguments: args,
	};
}

/**
 * Convert a single Rust entry to StoredEntry format.
 *
 * Handles the discriminated union pattern with explicit type narrowing
 * instead of nested ternaries for better readability and maintainability.
 *
 * @param entry - Entry from Rust backend
 * @returns StoredEntry for frontend storage
 */
export function convertRustEntryToStoredEntry(entry: RustStoredEntry): StoredEntry {
	const timestamp = parseTimestamp(entry.timestamp);

	switch (entry.type) {
		case "user":
			return {
				id: entry.id,
				type: "user",
				message: entry.message,
				timestamp,
			};

		case "assistant":
			return {
				id: entry.id,
				type: "assistant",
				message: entry.message,
				timestamp,
			};

		case "tool_call":
			return {
				id: entry.id,
				type: "tool_call",
				message: convertToolCall(entry.toolCall),
				timestamp,
			};

		default: {
			// TypeScript exhaustiveness check - this should never be reached
			// If a new entry type is added to RustStoredEntry, TypeScript will error here
			const _exhaustive: never = entry;
			throw new Error(`Unknown entry type: ${JSON.stringify(_exhaustive)}`);
		}
	}
}

/**
 * Convert an array of Rust entries to StoredEntry format.
 *
 * O(n) complexity where n is the number of entries.
 * Preserves order of entries.
 *
 * @param entries - Array of entries from Rust backend
 * @returns Array of StoredEntry for frontend storage
 */
export function convertRustEntriesToStoredEntries(entries: RustStoredEntry[]): StoredEntry[] {
	return entries.map(convertRustEntryToStoredEntry);
}

/**
 * Live entry from MessageProcessor.
 * These entries already have the correct schema (toolCall with arguments, not input).
 */
export type LiveProcessedEntry =
	| { id: string; type: "user"; message: unknown }
	| { id: string; type: "assistant"; message: unknown }
	| { id: string; type: "ask"; message: unknown }
	| { id: string; type: "tool_call"; toolCall: unknown };

/**
 * Convert a live processed entry to StoredEntry format.
 *
 * Used for entries from MessageProcessor which already have the correct schema.
 * Unlike Rust entries, live entries have toolCall with `arguments` not `input`.
 *
 * @param entry - Entry from MessageProcessor
 * @returns StoredEntry for frontend storage
 */
export function convertLiveEntryToStoredEntry(entry: LiveProcessedEntry): StoredEntry {
	switch (entry.type) {
		case "user":
			return {
				id: entry.id,
				type: "user",
				message: entry.message,
				timestamp: new Date(),
			};

		case "assistant":
			return {
				id: entry.id,
				type: "assistant",
				message: entry.message,
				timestamp: new Date(),
			};

		case "ask":
			return {
				id: entry.id,
				type: "ask",
				message: entry.message,
				timestamp: new Date(),
			};

		case "tool_call":
			return {
				id: entry.id,
				type: "tool_call",
				message: entry.toolCall,
				timestamp: new Date(),
			};

		default: {
			const _exhaustive: never = entry;
			throw new Error(`Unknown entry type: ${JSON.stringify(_exhaustive)}`);
		}
	}
}
