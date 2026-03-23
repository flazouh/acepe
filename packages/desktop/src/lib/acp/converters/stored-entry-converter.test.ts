import { describe, expect, it } from "vitest";
import type {
	StoredEntry,
	ToolArguments,
	ToolKind,
} from "$lib/services/converted-session-types.js";

import { convertStoredEntryToSessionEntry } from "./stored-entry-converter.js";

describe("stored-entry-converter", () => {
	describe("convertStoredEntryToSessionEntry", () => {
		describe("tool_call entries", () => {
			it("should convert tool_call entry with all fields", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-123",
					message: {
						id: "toolu_123",
						name: "Bash",
						status: "completed",
						kind: "execute",
						arguments: { kind: "execute", command: "ls -la" },
						result: "file1.txt\nfile2.txt",
						title: "Run command",
						awaitingPlanApproval: false,
					},
					timestamp: "2026-01-13T12:00:00Z",
				};
				const timestamp = new Date("2026-01-13T12:00:00Z");

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				expect(result.type).toBe("tool_call");
				expect(result.id).toBe("tool-123");
				expect(result.timestamp).toEqual(timestamp);

				if (result.type === "tool_call") {
					expect(result.message.id).toBe("toolu_123");
					expect(result.message.name).toBe("Bash");
					expect(result.message.status).toBe("completed");
					expect(result.message.kind).toBe("execute");
					expect(result.message.arguments).toEqual({
						kind: "execute",
						command: "ls -la",
					});
					expect(result.message.result).toBe("file1.txt\nfile2.txt");
					expect(result.message.title).toBe("Run command");
				}
			});

			it("should convert tool_call with missing optional fields", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-456",
					message: {
						id: "toolu_456",
						name: "Read",
						status: "pending",
						kind: "read",
						arguments: { kind: "read" },
						awaitingPlanApproval: false,
					},
					timestamp: null,
				};
				const timestamp = new Date();

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				expect(result.type).toBe("tool_call");
				if (result.type === "tool_call") {
					expect(result.message.arguments).toEqual({ kind: "read" });
					expect(result.message.result).toBeUndefined();
					expect(result.message.title).toBeUndefined();
				}
			});

			it("should convert tool_call with null arguments to other kind", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-789",
					message: {
						id: "toolu_789",
						name: "Edit",
						status: "completed",
						kind: "edit",
						arguments: { kind: "edit", edits: [] },
						result: "Success",
						title: null,
						awaitingPlanApproval: false,
					},
					timestamp: "2026-01-13T12:00:00Z",
				};
				const timestamp = new Date();

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				if (result.type === "tool_call") {
					expect(result.message.arguments).toEqual({ kind: "edit", edits: [] });
					expect(result.message.title).toBeNull();
				}
			});

			it("should handle all tool call status values", () => {
				const statuses = ["pending", "in_progress", "completed", "failed"] as const;

				for (const status of statuses) {
					const stored: StoredEntry = {
						type: "tool_call",
						id: `tool-${status}`,
						message: {
							id: `toolu_${status}`,
							name: "Bash",
							status,
							kind: "execute",
							arguments: { kind: "execute", command: null },
							awaitingPlanApproval: false,
						},
						timestamp: null,
					};

					const result = convertStoredEntryToSessionEntry(stored, new Date());

					if (result.type === "tool_call") {
						expect(result.message.status).toBe(status);
					}
				}
			});

			it("should handle all tool kinds", () => {
				const kinds = [
					"read",
					"edit",
					"execute",
					"search",
					"fetch",
					"think",
					"move",
					"delete",
					"enter_plan_mode",
					"exit_plan_mode",
					"other",
				] as const;

				for (const kind of kinds) {
					const storedArguments: ToolArguments =
						kind === "other"
							? { kind: "other" as const, raw: {} }
							: kind === "enter_plan_mode" || kind === "exit_plan_mode"
								? { kind: "planMode" as const, mode: kind }
								: kind === "edit"
									? { kind: "edit" as const, edits: [] }
									: { kind };

					const stored: StoredEntry = {
						type: "tool_call",
						id: `tool-${kind}`,
						message: {
							id: `toolu_${kind}`,
							name: "TestTool",
							status: "completed",
							kind: kind as ToolKind,
							arguments: storedArguments,
							awaitingPlanApproval: false,
						},
						timestamp: null,
					};

					const result = convertStoredEntryToSessionEntry(stored, new Date());

					if (result.type === "tool_call") {
						expect(result.message.kind).toBe(kind);
					}
				}
			});

			it("should handle complex nested arguments", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-complex",
					message: {
						id: "toolu_complex",
						name: "TodoWrite",
						status: "completed",
						kind: "think",
						arguments: {
							kind: "think",
							raw: {
								todos: [
									{ content: "Task 1", status: "completed", activeForm: "Completing task 1" },
									{ content: "Task 2", status: "in_progress", activeForm: "Working on task 2" },
								],
							},
						},
						awaitingPlanApproval: false,
					},
					timestamp: null,
				};
				const timestamp = new Date();

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				if (result.type === "tool_call") {
					expect(result.message.arguments).toEqual({
						kind: "think",
						raw: {
							todos: [
								{ content: "Task 1", status: "completed", activeForm: "Completing task 1" },
								{ content: "Task 2", status: "in_progress", activeForm: "Working on task 2" },
							],
						},
					});
				}
			});
		});

		describe("user entries", () => {
			it("should convert user entry", () => {
				const stored: StoredEntry = {
					type: "user",
					id: "user-123",
					message: {
						id: "msg-123",
						content: { type: "text", text: "Hello world" },
						chunks: [{ type: "text", text: "Hello world" }],
						sentAt: "2026-01-13T12:00:00Z",
					},
					timestamp: "2026-01-13T12:00:00Z",
				};
				const timestamp = new Date("2026-01-13T12:00:00Z");

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				expect(result.type).toBe("user");
				expect(result.id).toBe("user-123");
				expect(result.timestamp).toEqual(timestamp);
			});

			it("should preserve user message content", () => {
				const stored: StoredEntry = {
					type: "user",
					id: "user-456",
					message: {
						content: { type: "text", text: "Test message" },
						chunks: [],
					},
					timestamp: null,
				};

				const result = convertStoredEntryToSessionEntry(stored, new Date());

				expect(result.type).toBe("user");
				if (result.type === "user") {
					expect(result.message.content).toEqual({ type: "text", text: "Test message" });
				}
			});
		});

		describe("assistant entries", () => {
			it("should convert assistant entry", () => {
				const stored: StoredEntry = {
					type: "assistant",
					id: "assistant-123",
					message: {
						chunks: [{ type: "message", block: { type: "text", text: "Response text" } }],
						model: "claude-opus-4-5-20251101",
						displayModel: "Opus 4.5",
						receivedAt: "2026-01-13T12:00:00Z",
					},
					timestamp: "2026-01-13T12:00:00Z",
				};
				const timestamp = new Date("2026-01-13T12:00:00Z");

				const result = convertStoredEntryToSessionEntry(stored, timestamp);

				expect(result.type).toBe("assistant");
				expect(result.id).toBe("assistant-123");
				expect(result.timestamp).toEqual(timestamp);
			});

			it("should preserve assistant message chunks", () => {
				const stored: StoredEntry = {
					type: "assistant",
					id: "assistant-456",
					message: {
						chunks: [
							{ type: "thought", block: { type: "text", text: "Thinking..." } },
							{ type: "message", block: { type: "text", text: "Here's my response" } },
						],
						model: "claude-haiku-4-5-20251001",
					},
					timestamp: null,
				};

				const result = convertStoredEntryToSessionEntry(stored, new Date());

				expect(result.type).toBe("assistant");
				if (result.type === "assistant") {
					expect(result.message.chunks).toHaveLength(2);
				}
			});
		});

		describe("timestamp handling", () => {
			it("should use provided timestamp for all entry types", () => {
				const timestamp = new Date("2026-06-15T10:30:00.000Z");

				const entries: StoredEntry[] = [
					{
						type: "user",
						id: "user-1",
						message: { content: { type: "text" }, chunks: [] },
						timestamp: "2026-01-01T00:00:00Z",
					},
					{
						type: "assistant",
						id: "assistant-1",
						message: { chunks: [] },
						timestamp: "2026-01-01T00:00:00Z",
					},
					{
						type: "tool_call",
						id: "tool-1",
						message: {
							id: "toolu_1",
							name: "Test",
							status: "completed",
							kind: "other",
							arguments: { kind: "other", raw: {} },
							awaitingPlanApproval: false,
						},
						timestamp: "2026-01-01T00:00:00Z",
					},
				];

				for (const entry of entries) {
					const result = convertStoredEntryToSessionEntry(entry, timestamp);
					expect(result.timestamp).toEqual(timestamp);
				}
			});
		});

		describe("type safety", () => {
			it("should return correctly typed SessionEntry for tool_call", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-type-test",
					message: {
						id: "toolu_type",
						name: "Read",
						status: "completed",
						kind: "read",
						arguments: { kind: "read", file_path: "/test.ts" },
						awaitingPlanApproval: false,
					},
					timestamp: null,
				};

				const result = convertStoredEntryToSessionEntry(stored, new Date());

				// TypeScript narrowing test
				if (result.type === "tool_call") {
					// These should all compile without errors
					expect(result.message.id).toBeDefined();
					expect(result.message.name).toBeDefined();
					expect(result.message.status).toBeDefined();
					expect(result.message.arguments).toBeDefined();
				}
			});
		});

		describe("edge cases", () => {
			it("should handle empty arguments object", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-empty",
					message: {
						id: "toolu_empty",
						name: "EmptyTool",
						status: "completed",
						kind: "other",
						arguments: { kind: "other", raw: {} },
						awaitingPlanApproval: false,
					},
					timestamp: null,
				};

				const result = convertStoredEntryToSessionEntry(stored, new Date());

				if (result.type === "tool_call") {
					expect(result.message.arguments).toEqual({ kind: "other", raw: {} });
				}
			});

			it("should handle tool_call with all optional fields set to null", () => {
				const stored: StoredEntry = {
					type: "tool_call",
					id: "tool-all-null",
					message: {
						id: "toolu_null",
						name: "NullTool",
						status: "pending",
						kind: "other",
						arguments: { kind: "other", raw: {} },
						result: null,
						title: null,
						awaitingPlanApproval: false,
					},
					timestamp: null,
				};

				const result = convertStoredEntryToSessionEntry(stored, new Date());

				if (result.type === "tool_call") {
					expect(result.message.arguments).toEqual({ kind: "other", raw: {} });
					expect(result.message.result).toBeNull();
					expect(result.message.title).toBeNull();
				}
			});
		});
	});
});
