/**
 * Tool Call Event Flow Tests
 *
 * TDD tests to verify the complete flow of tool call events from
 * ACP session updates through to UI rendering.
 *
 * The flow is:
 * 1. ACP agent sends `tool_call` session update
 * 2. Rust backend parses and emits typed SessionUpdate event
 * 3. Frontend EventSubscriber receives the event
 * 4. SessionEventService.handleSessionUpdate processes it
 * 5. SessionStore.createToolCallEntry creates the entry
 * 6. UI receives the entry and renders via ToolCallRouter
 */

import { describe, expect, it } from "bun:test";

import type { SessionUpdate, ToolCallData } from "../../../services/converted-session-types.js";
import type { SessionEntry } from "../../application/dto/session.js";

import { SessionEntryStore } from "../session-entry-store.svelte.js";

function applyStreamingArguments(
	entryStore: SessionEntryStore,
	sessionId: string,
	toolCallId: string,
	streamingArguments: Parameters<SessionEntryStore["updateToolCallEntry"]>[1]["streamingArguments"]
): void {
	entryStore.updateToolCallEntry(sessionId, {
		toolCallId,
		status: null,
		result: null,
		content: null,
		rawOutput: null,
		title: null,
		locations: null,
		normalizedTodos: null,
		normalizedQuestions: null,
		streamingArguments,
	});
}

/**
 * Create a mock tool_call SessionUpdate matching what Rust sends.
 *
 * Based on the JSONL data:
 * - tool_use blocks have: id, name (mcp__acp__Read), input
 * - ACP adapter transforms to: toolCallId, _meta.claudeCode.toolName, rawInput, status, kind
 */
function createToolCallUpdate(
	sessionId: string,
	toolCallId: string,
	toolName: string,
	kind: "read" | "edit" | "execute" | "search" | "other" = "other",
	filePath?: string
): SessionUpdate {
	const toolCall: ToolCallData = {
		id: toolCallId,
		name: toolName,
		arguments:
			kind === "read"
				? { kind: "read", file_path: filePath ?? null }
				: kind === "edit"
					? {
							kind: "edit",
							edits: [
								{ filePath: filePath ?? null, oldString: null, newString: null, content: null },
							],
						}
					: { kind: "other", raw: {} },
		status: "pending",
		kind: kind,
		title: null,
		locations: null,
		skillMeta: null,
		result: null,
		awaitingPlanApproval: false,
	};

	return {
		type: "toolCall",
		tool_call: toolCall,
		session_id: sessionId,
	};
}

/**
 * Create a mock tool_call_update SessionUpdate matching what Rust sends.
 */
function createToolCallUpdateEvent(
	sessionId: string,
	toolCallId: string,
	status: "pending" | "in_progress" | "completed" | "failed" = "completed"
): SessionUpdate {
	return {
		type: "toolCallUpdate",
		update: {
			toolCallId: toolCallId,
			status: status,
			result: null,
			content: null,
			rawOutput: null,
			title: null,
			locations: null,
		},
		session_id: sessionId,
	};
}

/**
 * Helper to convert a SessionUpdate tool_call to a SessionEntry.
 * This mirrors the logic in session-event-service.svelte.ts
 */
function convertToolCallToEntry(update: SessionUpdate, entryId: string): SessionEntry | null {
	if (update.type !== "toolCall") {
		return null;
	}

	const toolCallData = update.tool_call;
	return {
		id: entryId,
		type: "tool_call",
		message: toolCallData,
		timestamp: new Date(),
	};
}

describe("Tool Call Event Flow", () => {
	async function appendAssistantChunks(
		entryStore: SessionEntryStore,
		sessionId: string,
		messageId: string,
		textChunks: readonly string[]
	): Promise<void> {
		for (const text of textChunks) {
			const result = await entryStore.aggregateAssistantChunk(
				sessionId,
				{ content: { type: "text", text } },
				messageId,
				false
			);
			expect(result.isOk()).toBe(true);
		}
	}

	function assistantEntryText(entry: SessionEntry): string {
		if (entry.type !== "assistant") return "";
		return entry.message.chunks
			.map((chunk) => (chunk.block.type === "text" ? chunk.block.text : ""))
			.join("");
	}

	describe("SessionUpdate parsing", () => {
		it("should correctly identify toolCall update type", () => {
			const update = createToolCallUpdate(
				"sess-123",
				"toolu_016jRdp79JqqfcH22yvZLkF3",
				"mcp__acp__Read",
				"read",
				"/Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts"
			);

			expect(update.type).toBe("toolCall");
		});

		it("should preserve tool call data through the update structure", () => {
			const update = createToolCallUpdate(
				"sess-123",
				"toolu_016jRdp79JqqfcH22yvZLkF3",
				"mcp__acp__Read",
				"read",
				"/path/to/file.ts"
			);

			if (update.type === "toolCall") {
				const toolCall = update.tool_call;
				expect(toolCall.id).toBe("toolu_016jRdp79JqqfcH22yvZLkF3");
				expect(toolCall.name).toBe("mcp__acp__Read");
				expect(toolCall.kind).toBe("read");
				expect(toolCall.status).toBe("pending");

				if (toolCall.arguments.kind === "read") {
					expect(toolCall.arguments.file_path).toBe("/path/to/file.ts");
				}
			}
		});

		it("should handle Edit tool call with old_string and new_string", () => {
			const update: SessionUpdate = {
				type: "toolCall",
				tool_call: {
					id: "toolu_01SYJ3hktXpiGHpucHrjNj7U",
					name: "mcp__acp__Edit",
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/path/to/file.ts",
								oldString: "export function multiply",
								newString: "export function multiply\n\nexport function subtract",
								content: null,
							},
						],
					},
					status: "pending",
					kind: "edit",
					title: null,
					locations: null,
					skillMeta: null,
					result: null,
					awaitingPlanApproval: false,
				},
				session_id: "sess-123",
			};

			if (update.type === "toolCall") {
				const toolCall = update.tool_call;
				expect(toolCall.name).toBe("mcp__acp__Edit");
				expect(toolCall.kind).toBe("edit");

				if (toolCall.arguments.kind === "edit") {
					expect(toolCall.arguments.edits[0]?.oldString).toContain("multiply");
					expect(toolCall.arguments.edits[0]?.newString).toContain("subtract");
				}
			}
		});
	});

	describe("SessionEntry conversion", () => {
		it("should convert toolCall update to tool_call SessionEntry", () => {
			const update = createToolCallUpdate(
				"sess-123",
				"toolu_abc123",
				"Read",
				"read",
				"/test/file.ts"
			);

			const entry = convertToolCallToEntry(update, "entry-1");

			expect(entry).not.toBeNull();
			expect(entry?.type).toBe("tool_call");
			expect(entry?.id).toBe("entry-1");
			if (entry !== null && entry.type === "tool_call") {
				expect(entry.message.id).toBe("toolu_abc123");
				expect(entry.message.name).toBe("Read");
			}
		});

		it("should include all tool call fields in the entry message", () => {
			const update = createToolCallUpdate(
				"sess-123",
				"toolu_xyz789",
				"mcp__acp__Read",
				"read",
				"/path/to/file.ts"
			);

			const entry = convertToolCallToEntry(update, "entry-2");

			expect(entry).not.toBeNull();
			expect(entry?.type).toBe("tool_call");
			if (entry !== null && entry.type === "tool_call") {
				const message = entry.message;
				expect(message.id).toBe("toolu_xyz789");
				expect(message.name).toBe("mcp__acp__Read");
				expect(message.status).toBe("pending");
				expect(message.kind).toBe("read");
				expect(message.arguments).toBeDefined();
			}
		});

		it("should return null for non-toolCall updates", () => {
			const textUpdate: SessionUpdate = {
				type: "agentMessageChunk",
				chunk: { content: { type: "text", text: "Hello world" } },
				message_id: "msg-1",
				session_id: "sess-123",
			};

			const entry = convertToolCallToEntry(textUpdate, "entry-3");
			expect(entry).toBeNull();
		});
	});

	describe("Tool call update handling", () => {
		it("should correctly parse toolCallUpdate events", () => {
			const update = createToolCallUpdateEvent("sess-123", "toolu_abc123", "completed");

			expect(update.type).toBe("toolCallUpdate");

			if (update.type === "toolCallUpdate") {
				expect(update.update.toolCallId).toBe("toolu_abc123");
				expect(update.update.status).toBe("completed");
			}
		});

		it("should handle all status transitions", () => {
			const statuses: Array<"pending" | "in_progress" | "completed" | "failed"> = [
				"pending",
				"in_progress",
				"completed",
				"failed",
			];

			for (const status of statuses) {
				const update = createToolCallUpdateEvent("sess-123", "toolu_test", status);

				if (update.type === "toolCallUpdate") {
					expect(update.update.status).toBe(status);
				}
			}
		});
	});

	describe("MCP tool name handling", () => {
		it("should handle mcp__acp__ prefixed tool names", () => {
			const toolNames = ["mcp__acp__Read", "mcp__acp__Edit", "mcp__acp__Bash"];

			for (const name of toolNames) {
				const update = createToolCallUpdate("sess-123", "toolu_123", name);

				if (update.type === "toolCall") {
					expect(update.tool_call.name).toBe(name);
					// The UI should strip the prefix or handle it appropriately
					expect(update.tool_call.name.startsWith("mcp__acp__")).toBe(true);
				}
			}
		});

		it("should also handle non-prefixed tool names", () => {
			const toolNames = ["Read", "Edit", "Bash", "Grep", "Glob"];

			for (const name of toolNames) {
				const update = createToolCallUpdate("sess-123", "toolu_123", name);

				if (update.type === "toolCall") {
					expect(update.tool_call.name).toBe(name);
					expect(update.tool_call.name.startsWith("mcp__acp__")).toBe(false);
				}
			}
		});
	});

	describe("Integration: complete flow simulation", () => {
		it("should process a Read tool call end-to-end", () => {
			const sessionId = "0e9e5660-930d-4238-8e0b-f5790d5c2e01";
			const toolCallId = "toolu_016jRdp79JqqfcH22yvZLkF3";

			// Step 1: Create the tool_call update (simulating what Rust sends)
			const toolCallUpdate = createToolCallUpdate(
				sessionId,
				toolCallId,
				"mcp__acp__Read",
				"read",
				"/Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts"
			);

			// Step 2: Verify it's a valid toolCall update
			expect(toolCallUpdate.type).toBe("toolCall");

			// Step 3: Convert to SessionEntry
			const entry = convertToolCallToEntry(toolCallUpdate, `tool-${toolCallId}`);
			expect(entry).not.toBeNull();
			expect(entry?.type).toBe("tool_call");

			// Step 4: Create the tool_call_update (when tool completes)
			const completionUpdate = createToolCallUpdateEvent(sessionId, toolCallId, "completed");
			expect(completionUpdate.type).toBe("toolCallUpdate");

			if (completionUpdate.type === "toolCallUpdate") {
				expect(completionUpdate.update.toolCallId).toBe(toolCallId);
				expect(completionUpdate.update.status).toBe("completed");
			}
		});

		it("should process an Edit tool call with diff result", () => {
			const sessionId = "0e9e5660-930d-4238-8e0b-f5790d5c2e01";
			const toolCallId = "toolu_01SYJ3hktXpiGHpucHrjNj7U";

			// Create Edit tool call
			const editUpdate: SessionUpdate = {
				type: "toolCall",
				tool_call: {
					id: toolCallId,
					name: "mcp__acp__Edit",
					arguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts",
								oldString:
									"export function multiply(a: number, b: number): number {\n\treturn a * b;\n}",
								newString:
									"export function multiply(a: number, b: number): number {\n\treturn a * b;\n}\n\nexport function subtract(a: number, b: number): number {\n\treturn a - b;\n}",
								content: null,
							},
						],
					},
					status: "pending",
					kind: "edit",
					title: null,
					locations: null,
					skillMeta: null,
					result: null,
					awaitingPlanApproval: false,
				},
				session_id: sessionId,
			};

			// Verify structure
			expect(editUpdate.type).toBe("toolCall");

			if (editUpdate.type === "toolCall") {
				const toolCall = editUpdate.tool_call;
				expect(toolCall.name).toBe("mcp__acp__Edit");
				expect(toolCall.kind).toBe("edit");

				if (toolCall.arguments.kind === "edit") {
					expect(toolCall.arguments.edits[0]?.oldString).toContain("multiply");
					expect(toolCall.arguments.edits[0]?.newString).toContain("subtract");
				}
			}

			// Convert to entry
			const entry = convertToolCallToEntry(editUpdate, `tool-${toolCallId}`);
			expect(entry).not.toBeNull();
			expect(entry?.type).toBe("tool_call");
			if (entry !== null && entry.type === "tool_call") {
				expect(entry.message.kind).toBe("edit");
			}
		});
	});

	describe("Task child tool attachment", () => {
		it("stores parent task with pre-assembled children from backend", () => {
			// Backend TaskReconciler now handles parent-child reconciliation.
			// Frontend receives parent with taskChildren already assembled.
			const sessionId = "sess-123";
			const entryStore = new SessionEntryStore();

			const child: ToolCallData = {
				id: "child-1",
				name: "Read",
				arguments: { kind: "read", file_path: "src/main.ts" },
				status: "completed",
				kind: "read",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
				parentToolUseId: "task-1",
				taskChildren: null,
			};

			// Parent arrives with child already attached by backend TaskReconciler
			const parentWithChild: ToolCallData = {
				id: "task-1",
				name: "Task",
				arguments: { kind: "think", description: "Do work" },
				status: "pending",
				kind: "think",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
				parentToolUseId: null,
				taskChildren: [child],
			};

			entryStore.createToolCallEntry(sessionId, parentWithChild);

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			const tool = entries[0]?.message as ToolCallData;
			expect(tool.taskChildren?.length).toBe(1);
			expect(tool.taskChildren?.[0]?.id).toBe("child-1");
		});

		it("updates an existing parent task when a later emission adds child tools", () => {
			const sessionId = "sess-123";
			const entryStore = new SessionEntryStore();

			entryStore.createToolCallEntry(sessionId, {
				id: "task-1",
				name: "Task",
				arguments: { kind: "think", description: "Do work" },
				status: "in_progress",
				kind: "task",
				title: "Task",
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
				parentToolUseId: null,
				taskChildren: null,
			});

			entryStore.createToolCallEntry(sessionId, {
				id: "task-1",
				name: "Task",
				arguments: { kind: "think", description: "Do work" },
				status: "in_progress",
				kind: "task",
				title: "Task",
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
				parentToolUseId: null,
				taskChildren: [
					{
						id: "child-1",
						name: "Read",
						arguments: { kind: "read", file_path: "src/main.ts" },
						status: "completed",
						kind: "read",
						title: "Read file",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
						parentToolUseId: "task-1",
						taskChildren: null,
					},
				],
			});

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			if (entries[0]?.type !== "tool_call") return;

			expect(entries[0].message.id).toBe("task-1");
			expect(entries[0].message.taskChildren?.length).toBe(1);
			expect(entries[0].message.taskChildren?.[0]?.id).toBe("child-1");
		});
	});

	describe("Streaming args race condition (session 16c15e5c blank card bug)", () => {
		/**
		 * Reproduces the exact event sequence from the streaming log:
		 *
		 * 1. Initial tool_call with rawInput: {} → creates entry with empty edit args
		 * 2. ~400 streamingInputDelta updates → streaming args stored in SvelteMap
		 * 3. Second tool_call with full rawInput → calls createEntry again (re-create path)
		 *
		 * The bug: createEntry() calls clearStreamingArguments() BEFORE the entry
		 * update is committed. Since the entry update goes through pendingUpdates
		 * (plain Map, no reactive signal) while streaming args are in SvelteMap
		 * (immediate reactive signal), there's a window where:
		 * - streaming args = undefined (just cleared)
		 * - base entry args = still old empty args (update not flushed)
		 * - mergedArguments falls back to empty base → hasContent = false → blank card
		 */
		it("streaming args must survive until entry update is committed", () => {
			const sessionId = "sess-16c15e5c";
			const toolCallId = "toolu_write_blank_card";
			const entryStore = new SessionEntryStore();

			// Step 1: First tool_call arrives with empty arguments (rawInput: {})
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Write",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Step 2: Streaming deltas arrive — streaming args accumulate
			applyStreamingArguments(entryStore, sessionId, toolCallId, {
				kind: "edit" as const,
				edits: [
					{
						filePath: "/path/to/plan.md",
						oldString: null,
						newString: null,
						content: "# The Plan\n\nThis is the full plan content...",
					},
				],
			});

			// Verify streaming args are available
			expect(entryStore.getStreamingArguments(toolCallId)).toBeDefined();
			expect(entryStore.getStreamingArguments(toolCallId)?.kind).toBe("edit");

			// Step 3: Second tool_call arrives with full arguments (re-create path)
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Write",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/path/to/plan.md",
							oldString: null,
							newString: null,
							content: "# The Plan\n\nThis is the full plan content...",
						},
					],
				},
				status: "completed",
				kind: "edit",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// CRITICAL ASSERTION: After createEntry re-create path,
			// at least one of these must be true:
			// (a) streaming args are still available as fallback, OR
			// (b) the entry already has the full arguments
			//
			// Entries are written directly to the store (no batching),
			// so they are immediately available via getEntries().
			// If streaming args are cleared AND the entry has old args,
			// the UI sees empty data → blank card.

			const streamingArgsAfter = entryStore.getStreamingArguments(toolCallId);
			const entries = entryStore.getEntries(sessionId);

			// Check entries (what Svelte actually reacts to)
			const committedEntry = entries[0];
			const committedHasContent =
				committedEntry?.type === "tool_call" &&
				committedEntry.message.arguments.kind === "edit" &&
				committedEntry.message.arguments.edits[0]?.content != null;

			const hasStreamingFallback =
				streamingArgsAfter?.kind === "edit" && streamingArgsAfter.edits[0]?.content != null;

			// At least one reactive source must have content — otherwise blank card.
			// This is the exact invariant that was violated in session 16c15e5c.
			expect(committedHasContent || hasStreamingFallback).toBe(true);
		});

		it("preserves full arguments when completion update arrives before RAF flush", () => {
			const sessionId = "sess-rapid-complete";
			const toolCallId = "toolu_rapid_complete";
			const entryStore = new SessionEntryStore();

			// Step 1: Existing committed placeholder-like entry (mirrors real log timing:
			// initial tool_call already flushed long before completion arrives).
			entryStore.storeEntriesAndBuildIndex(sessionId, [
				{
					id: toolCallId,
					type: "tool_call",
					timestamp: new Date(),
					isStreaming: true,
					message: {
						id: toolCallId,
						name: "Edit",
						arguments: {
							kind: "edit",
							edits: [{ filePath: null, oldString: null, newString: null, content: null }],
						},
						status: "pending",
						kind: "edit",
						title: "Edit",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
					},
				},
			]);

			// Step 2: Full tool_call arrives (still pending), but update is RAF-batched.
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/Users/example/.claude/plans/test.md",
							oldString: "old",
							newString: "new",
							content: null,
						},
					],
				},
				status: "pending",
				kind: "edit",
				title: "Edit `/Users/example/.claude/plans/test.md`",
				locations: [{ path: "/Users/example/.claude/plans/test.md" }],
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Step 3: Completion update arrives immediately (same frame).
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: [{ path: "/Users/example/.claude/plans/test.md" }],
			});

			// Regression assertion: final merged entry must retain full edit arguments.
			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			if (entries[0]?.type !== "tool_call") return;

			const args = entries[0].message.arguments;
			expect(args.kind).toBe("edit");
			if (args.kind !== "edit") return;
			expect(args.edits[0]?.filePath).toBe("/Users/example/.claude/plans/test.md");
			expect(args.edits[0]?.oldString).toBe("old");
			expect(args.edits[0]?.newString).toBe("new");
		});

		it("preserves generic read title when backend omits a canonical title", () => {
			const sessionId = "sess-cursor-backfill-read";
			const toolCallId = "tool_cursor_read_1";
			const filePath = "/Users/example/Documents/acepe/README.md";
			const entryStore = new SessionEntryStore();

			entryStore.storeEntriesAndBuildIndex(sessionId, [
				{
					id: toolCallId,
					type: "tool_call",
					timestamp: new Date(),
					isStreaming: true,
					message: {
						id: toolCallId,
						name: "Read",
						arguments: {
							kind: "read",
							file_path: null,
						},
						status: "pending",
						kind: "read",
						title: "Read File",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
					},
				},
			]);

			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "in_progress",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: [{ path: filePath }],
				arguments: {
					kind: "read",
					file_path: filePath,
				},
			});

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			if (entries[0]?.type !== "tool_call") return;

			const args = entries[0].message.arguments;
			expect(args.kind).toBe("read");
			if (args.kind !== "read") return;
			expect(args.file_path).toBe(filePath);
			expect(entries[0].message.title).toBe("Read File");
			expect(entries[0].message.locations?.[0]?.path).toBe(filePath);
		});

		it("preserves explicit update title from backend", () => {
			const sessionId = "sess-cursor-backfill-read-explicit-title";
			const toolCallId = "tool_cursor_read_2";
			const filePath = "/Users/example/Documents/acepe/README.md";
			const explicitTitle = "Read README.md";
			const entryStore = new SessionEntryStore();

			entryStore.storeEntriesAndBuildIndex(sessionId, [
				{
					id: toolCallId,
					type: "tool_call",
					timestamp: new Date(),
					isStreaming: true,
					message: {
						id: toolCallId,
						name: "Read",
						arguments: {
							kind: "read",
							file_path: null,
						},
						status: "pending",
						kind: "read",
						title: "Read File",
						locations: null,
						skillMeta: null,
						result: null,
						awaitingPlanApproval: false,
					},
				},
			]);

			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "in_progress",
				result: null,
				content: null,
				rawOutput: null,
				title: explicitTitle,
				locations: [{ path: filePath }],
				arguments: {
					kind: "read",
					file_path: filePath,
				},
			});

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			if (entries[0]?.type !== "tool_call") return;

			expect(entries[0].message.title).toBe(explicitTitle);
		});

		it("streaming args are cleaned up when tool completes", () => {
			const sessionId = "sess-cleanup";
			const toolCallId = "toolu_cleanup_test";
			const entryStore = new SessionEntryStore();

			// Create tool call entry
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Read",
				arguments: { kind: "read", file_path: "/some/file.ts" },
				status: "pending",
				kind: "read",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Set streaming args
			applyStreamingArguments(entryStore, sessionId, toolCallId, {
				kind: "read",
				file_path: "/some/file.ts",
			});
			expect(entryStore.getStreamingArguments(toolCallId)).toBeDefined();

			// Tool completes via updateToolCallEntry
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "completed",
				result: "file contents here",
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
			});

			// After completion, streaming args should be cleaned up
			expect(entryStore.getStreamingArguments(toolCallId)).toBeUndefined();
		});

		it("replays 741d9bee edit sequence with progressive args and final completion", () => {
			const sessionId = "741d9bee-d3d0-4691-8afa-1a12bcdfdaeb";
			const toolCallId = "toolu_01Wv8NKq3rrz3uhJwFaFz4xi";
			const filePath = "/Users/example/.claude/plans/sample-plan.md";
			const entryStore = new SessionEntryStore();

			entryStore.storeEntriesAndBuildIndex(sessionId, []);

			// Log replay step 1: initial tool_call arrives without parsed arguments.
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: "Edit",
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Log replay step 2: progressive streaming deltas produce parsed arguments.
			applyStreamingArguments(entryStore, sessionId, toolCallId, {
				kind: "edit",
				edits: [{ filePath, oldString: null, newString: null, content: null }],
			});
			applyStreamingArguments(entryStore, sessionId, toolCallId, {
				kind: "edit",
				edits: [
					{
						filePath,
						oldString: "# Test Plan",
						newString: "# Test Plan\n\nThis is a test plan...",
						content: null,
					},
				],
			});

			const streamingArgs = entryStore.getStreamingArguments(toolCallId);
			expect(streamingArgs?.kind).toBe("edit");
			if (streamingArgs?.kind === "edit") {
				expect(streamingArgs.edits[0]?.filePath).toBe(filePath);
			}

			// Log replay step 3: full tool_call arrives with authoritative arguments.
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Edit",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath,
							oldString: "# Test Plan",
							newString: "# Test Plan\n\nThis is a test plan...",
							content: null,
						},
					],
				},
				status: "pending",
				kind: "edit",
				title: `Edit \`${filePath}\``,
				locations: [{ path: filePath }],
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Log replay step 4: terminal update marks completion.
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: [{ path: filePath }],
			});

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			expect(entries[0]?.isStreaming).toBe(false);
			if (entries[0]?.type !== "tool_call") return;

			expect(entries[0].message.status).toBe("completed");
			const args = entries[0].message.arguments;
			expect(args.kind).toBe("edit");
			if (args.kind !== "edit") return;
			expect(args.edits[0]?.filePath).toBe(filePath);
			expect(args.edits[0]?.oldString).toBe("# Test Plan");
			expect(args.edits[0]?.newString).toContain("This is a test plan");

			// Terminal status should clear progressive cache.
			expect(entryStore.getStreamingArguments(toolCallId)).toBeUndefined();
		});
	});

	describe("Codex replay regressions", () => {
		it("replays 4a5e6a70 write flow where content arrives in tool_call_update arguments", () => {
			const sessionId = "4a5e6a70-b9a0-440e-871c-90acd10823b3";
			const toolCallId = "toolu_01PEfCYGuNwA64xuw74mpsU6";
			const filePath = "/Users/example/Documents/articles/articles.csv";
			const csvContent =
				"folder,title\\nai-agents-explainer,What Is an AI Agent and Why It Matters";
			const entryStore = new SessionEntryStore();

			entryStore.storeEntriesAndBuildIndex(sessionId, []);

			// Log line 356: initial pending Write arrives with empty edit args.
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Write",
				arguments: {
					kind: "edit",
					edits: [{ filePath: null, oldString: null, newString: null, content: null }],
				},
				status: "pending",
				kind: "edit",
				title: "Write",
				locations: [],
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});

			// Log line 357: update carries parsed arguments from rawInput including content/file_path.
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: null,
				result: null,
				content: null,
				rawOutput: null,
				title: `Write ${filePath}`,
				locations: [{ path: filePath }],
				arguments: {
					kind: "edit",
					edits: [{ filePath, oldString: null, newString: null, content: csvContent }],
				},
			});

			const entries = entryStore.getEntries(sessionId);
			expect(entries.length).toBe(1);
			expect(entries[0]?.type).toBe("tool_call");
			if (entries[0]?.type !== "tool_call") return;

			const args = entries[0].message.arguments;
			expect(args.kind).toBe("edit");
			if (args.kind !== "edit") return;
			expect(args.edits[0]?.filePath).toBe(filePath);
			expect(args.edits[0]?.content).toBe(csvContent);
			expect(args.edits[0]?.newString).toBeNull();
			expect(entries[0].message.locations?.[0]?.path).toBe(filePath);
		});

		it("ignores update-first placeholder synthesis and waits for canonical tool data", () => {
			const sessionId = "sess-codex-replay";
			const toolCallId = "tool-codex-search-1";
			const entryStore = new SessionEntryStore();

			// Step 1: Update arrives first (no tool_call yet) and is discarded.
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "pending",
				result: null,
				content: null,
				rawOutput: null,
				title: "Search branch:main|branch: in desktop",
				locations: null,
			});

			expect(entryStore.getEntries(sessionId)).toHaveLength(0);

			// Step 2: Full tool call data arrives with completed status.
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Search",
				arguments: { kind: "search", query: "branch:main", file_path: null },
				status: "completed",
				kind: "search",
				title: "Search",
				locations: null,
				skillMeta: null,
				result: { output: "no matches", exitCode: 0 },
				awaitingPlanApproval: false,
			});

			const afterFullData = entryStore.getEntries(sessionId);
			expect(afterFullData.length).toBe(1);
			expect(afterFullData[0]?.isStreaming).toBe(false);
			if (afterFullData[0]?.type === "tool_call") {
				expect(afterFullData[0].message.name).toBe("Search");
				expect(afterFullData[0].message.status).toBe("completed");
				expect(afterFullData[0].message.kind).toBe("search");
			}
		});

		it("rebuilds the same normalized execute result for live updates and preloaded history", () => {
			const toolCallResult = {
				content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
				detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
			};
			const liveStore = new SessionEntryStore();
			const preloadStore = new SessionEntryStore();

			liveStore.updateToolCallEntry("live-session", {
				toolCallId: "tool-execute-1",
				status: "completed",
				result: toolCallResult,
				content: null,
				rawOutput: null,
				title: "pwd",
				locations: null,
				arguments: { kind: "execute", command: "pwd" },
			});

			preloadStore.storeEntriesAndBuildIndex("preload-session", [
				{
					id: "tool-execute-1",
					type: "tool_call",
					message: {
						id: "tool-execute-1",
						name: "Bash",
						arguments: { kind: "execute", command: "pwd" },
						status: "completed",
						kind: "execute",
						title: "pwd",
						locations: null,
						skillMeta: null,
						result: toolCallResult,
						awaitingPlanApproval: false,
					},
					timestamp: new Date(),
				},
			]);

			const liveEntry = liveStore.getEntries("live-session")[0];
			const preloadEntry = preloadStore.getEntries("preload-session")[0];
			expect(liveEntry?.type).toBe("tool_call");
			expect(preloadEntry?.type).toBe("tool_call");
			if (liveEntry?.type === "tool_call" && preloadEntry?.type === "tool_call") {
				expect(preloadEntry.message.normalizedResult).toEqual(liveEntry.message.normalizedResult);
				expect(preloadEntry.message.normalizedResult).toEqual({
					kind: "execute",
					stdout: "/Users/alex/Documents/acepe",
					stderr: null,
					exitCode: 0,
				});
			}
		});

		it("replays bcf05737 log message/tool/message sequence without cross-message contamination", async () => {
			const sessionId = "bcf05737-324d-44d8-a0c1-cd23a1c3fc4e";
			const firstMessageId = "msg_01F9LtXBrEAoAXTbABKubhiL";
			const secondMessageId = "msg_01AP3pFFZtvp9xHniB5MxjrX";
			const toolCallId = "toolu_01CV29KagTmUQLf1Yd3Ysa7e";
			const entryStore = new SessionEntryStore();
			entryStore.storeEntriesAndBuildIndex(sessionId, []);

			// Replay lines 460-508 from the streaming log (pre-tool assistant message).
			await appendAssistantChunks(entryStore, sessionId, firstMessageId, [
				"No, that's not true! ",
				"There are many #[tauri::command] annotations in the codebase.",
				" The issue is that the built-in Grep tool was failing.",
			]);

			// Replay the tool boundary (lines 509-533).
			entryStore.createToolCallEntry(sessionId, {
				id: toolCallId,
				name: "Bash",
				arguments: {
					kind: "execute",
					command: 'grep -r "#\\[tauri::command\\]" src/ --include="*.rs" | wc -l',
				},
				status: "pending",
				kind: "execute",
				title: null,
				locations: null,
				skillMeta: null,
				result: null,
				awaitingPlanApproval: false,
			});
			entryStore.updateToolCallEntry(sessionId, {
				toolCallId,
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
			});

			// Replay lines 534+ (post-tool assistant message).
			await appendAssistantChunks(entryStore, sessionId, secondMessageId, [
				"There are **143** `#[tauri::command]` annotations in the codebase.",
				" The Grep tool failure gave you a false negative.",
			]);

			const entries = entryStore.getEntries(sessionId);
			expect(entries.map((entry) => entry.type)).toEqual(["assistant", "tool_call", "assistant"]);

			const firstAssistantText = assistantEntryText(entries[0]);
			const secondAssistantText = assistantEntryText(entries[2]);

			expect(firstAssistantText).toContain("No, that's not true!");
			expect(firstAssistantText).toContain("many #[tauri::command]");
			expect(firstAssistantText).not.toContain("**143**");

			expect(secondAssistantText).toContain("There are **143**");
			expect(secondAssistantText).toContain("false negative");
			expect(secondAssistantText).not.toContain("No, that's not true!");
		});
	});
});
