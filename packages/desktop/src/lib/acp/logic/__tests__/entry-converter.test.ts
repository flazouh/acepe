import { describe, expect, it } from "vitest";

import type { StoredEntry } from "../../infrastructure/storage/ThreadStorage.js";

import {
	convertLiveEntryToStoredEntry,
	convertRustEntriesToStoredEntries,
	convertRustEntryToStoredEntry,
	type LiveProcessedEntry,
	type RustStoredEntry,
} from "../entry-converter.js";

describe("entry-converter", () => {
	describe("convertRustEntryToStoredEntry", () => {
		describe("user entries", () => {
			it("should convert user entry with message", () => {
				const rustEntry: RustStoredEntry = {
					type: "user",
					id: "user-123",
					message: {
						id: "msg-123",
						content: { type: "text", text: "Hello world" },
						chunks: [{ type: "text", text: "Hello world" }],
						sentAt: "2024-01-01T00:00:00Z",
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				expect(result.id).toBe("user-123");
				expect(result.type).toBe("user");
				expect(result.message).toEqual(rustEntry.message);
				expect(result.timestamp).toBeInstanceOf(Date);
			});

			it("should handle user entry without timestamp", () => {
				const rustEntry: RustStoredEntry = {
					type: "user",
					id: "user-123",
					message: { id: "msg-123", content: { type: "text", text: "Hello" } },
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				expect(result.timestamp).toBeInstanceOf(Date);
			});
		});

		describe("assistant entries", () => {
			it("should convert assistant entry with message", () => {
				const rustEntry: RustStoredEntry = {
					type: "assistant",
					id: "assistant-123",
					message: {
						chunks: [{ type: "message", block: { type: "text", text: "Response" } }],
						model: "claude-3-opus",
						receivedAt: "2024-01-01T00:00:00Z",
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				expect(result.id).toBe("assistant-123");
				expect(result.type).toBe("assistant");
				expect(result.message).toEqual(rustEntry.message);
			});
		});

		describe("tool_call entries", () => {
			it("should convert tool_call entry and rename input to arguments", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "tool-123",
					toolCall: {
						id: "toolu_123",
						name: "Edit",
						status: "completed",
						result: "File updated successfully",
						kind: "edit",
						input: {
							file_path: "/path/to/file.ts",
							old_string: "old code",
							new_string: "new code",
						},
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				expect(result.id).toBe("tool-123");
				expect(result.type).toBe("tool_call");

				// Critical: input should be renamed to arguments
				const toolCall = result.message as Record<string, unknown>;
				expect(toolCall.arguments).toEqual({
					file_path: "/path/to/file.ts",
					old_string: "old code",
					new_string: "new code",
				});
				expect(toolCall.input).toBeUndefined(); // input should NOT be present
				expect(toolCall.name).toBe("Edit");
				expect(toolCall.status).toBe("completed");
				expect(toolCall.result).toBe("File updated successfully");
				expect(toolCall.kind).toBe("edit");
			});

			it("should handle tool_call with undefined input", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "tool-123",
					toolCall: {
						id: "toolu_123",
						name: "Read",
						status: "pending",
						kind: "read",
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.arguments).toEqual({});
			});

			it("should handle tool_call with null input", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "tool-123",
					toolCall: {
						id: "toolu_123",
						name: "Bash",
						status: "completed",
						kind: "execute",
						input: null as unknown as undefined,
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.arguments).toEqual({});
			});

			it("should preserve all tool_call fields except input", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "tool-123",
					toolCall: {
						id: "toolu_abc",
						name: "Task",
						title: "Running background task",
						status: "in_progress",
						result: undefined,
						kind: "think",
						input: { description: "Test task" },
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.id).toBe("toolu_abc");
				expect(toolCall.name).toBe("Task");
				expect(toolCall.title).toBe("Running background task");
				expect(toolCall.status).toBe("in_progress");
				expect(toolCall.result).toBeUndefined();
				expect(toolCall.kind).toBe("think");
				expect(toolCall.arguments).toEqual({ description: "Test task" });
			});

			it("should handle TodoWrite tool call correctly", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "todo-123",
					toolCall: {
						id: "toolu_todo",
						name: "TodoWrite",
						status: "completed",
						kind: "think",
						input: {
							todos: [
								{
									content: "Task 1",
									status: "completed",
									activeForm: "Completing task 1",
								},
								{
									content: "Task 2",
									status: "in_progress",
									activeForm: "Working on task 2",
								},
							],
						},
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.name).toBe("TodoWrite");
				expect(toolCall.arguments).toEqual({
					todos: [
						{
							content: "Task 1",
							status: "completed",
							activeForm: "Completing task 1",
						},
						{
							content: "Task 2",
							status: "in_progress",
							activeForm: "Working on task 2",
						},
					],
				});
			});

			it("should handle Bash tool call correctly", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "bash-123",
					toolCall: {
						id: "toolu_bash",
						name: "Bash",
						status: "completed",
						result: "Command output here",
						kind: "execute",
						input: {
							command: "npm test",
							description: "Run tests",
						},
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.name).toBe("Run");
				expect(toolCall.arguments).toEqual({
					command: "npm test",
					description: "Run tests",
				});
				expect(toolCall.result).toBe("Command output here");
			});

			// CHARACTERIZATION: remove when projected union is authoritative — entry conversion does not
			// rewrite tool `kind`; semantic flattening (e.g. to agent-panel buckets) happens elsewhere.
			it("CHARACTERIZATION: preserves sql tool kind from Rust (remove when projected union is authoritative)", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "sql-1",
					toolCall: {
						id: "toolu_sql",
						name: "run_query",
						status: "completed",
						kind: "sql",
						input: { query: "SELECT 1", description: "Smoke" },
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.kind).toBe("sql");
				expect(toolCall.arguments).toEqual({ query: "SELECT 1", description: "Smoke" });
			});

			it("CHARACTERIZATION: preserves unclassified tool kind from Rust (remove when projected union is authoritative)", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "un-1",
					toolCall: {
						id: "toolu_un",
						name: "unknown",
						status: "pending",
						kind: "unclassified",
						input: { raw_name: "mcp__x__Thing", raw_kind_hint: "other" },
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.kind).toBe("unclassified");
				expect(toolCall.arguments).toEqual({
					raw_name: "mcp__x__Thing",
					raw_kind_hint: "other",
				});
			});

			it("CHARACTERIZATION: does not promote other+sql-shaped payload to sql kind (remove when projected union is authoritative)", () => {
				const rustEntry: RustStoredEntry = {
					type: "tool_call",
					id: "reg-1",
					toolCall: {
						id: "toolu_reg",
						name: "unknown",
						status: "completed",
						kind: "other",
						input: { query: "UPDATE todos SET done = true" },
					},
					timestamp: "2024-01-01T00:00:00Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);
				const toolCall = result.message as Record<string, unknown>;

				expect(toolCall.kind).toBe("other");
				expect(toolCall.arguments).toEqual({ query: "UPDATE todos SET done = true" });
			});
		});

		describe("timestamp handling", () => {
			it("should parse ISO timestamp string", () => {
				const rustEntry: RustStoredEntry = {
					type: "user",
					id: "user-123",
					message: { id: "msg-123" },
					timestamp: "2024-06-15T10:30:00.000Z",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				expect(result.timestamp.toISOString()).toBe("2024-06-15T10:30:00.000Z");
			});

			it("should use current date when timestamp is missing", () => {
				const before = new Date();

				const rustEntry: RustStoredEntry = {
					type: "user",
					id: "user-123",
					message: { id: "msg-123" },
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				const after = new Date();
				expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
				expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
			});

			it("should use current date when timestamp is empty string", () => {
				const before = new Date();

				const rustEntry: RustStoredEntry = {
					type: "user",
					id: "user-123",
					message: { id: "msg-123" },
					timestamp: "",
				};

				const result = convertRustEntryToStoredEntry(rustEntry);

				const after = new Date();
				expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
				expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
			});
		});
	});

	describe("convertRustEntriesToStoredEntries", () => {
		it("should convert empty array", () => {
			const result = convertRustEntriesToStoredEntries([]);
			expect(result).toEqual([]);
		});

		it("should convert array of mixed entry types", () => {
			const rustEntries: RustStoredEntry[] = [
				{
					type: "user",
					id: "user-1",
					message: { id: "msg-1", content: { type: "text", text: "Question" } },
					timestamp: "2024-01-01T00:00:00Z",
				},
				{
					type: "assistant",
					id: "assistant-1",
					message: { chunks: [], receivedAt: "2024-01-01T00:01:00Z" },
					timestamp: "2024-01-01T00:01:00Z",
				},
				{
					type: "tool_call",
					id: "tool-1",
					toolCall: {
						id: "toolu_1",
						name: "Read",
						status: "completed",
						kind: "read",
						input: { file_path: "/test.ts" },
					},
					timestamp: "2024-01-01T00:02:00Z",
				},
			];

			const result = convertRustEntriesToStoredEntries(rustEntries);

			expect(result).toHaveLength(3);
			expect(result[0].type).toBe("user");
			expect(result[1].type).toBe("assistant");
			expect(result[2].type).toBe("tool_call");

			// Verify tool_call has arguments, not input
			const toolCall = result[2].message as Record<string, unknown>;
			expect(toolCall.arguments).toEqual({ file_path: "/test.ts" });
		});

		it("should preserve order of entries", () => {
			const rustEntries: RustStoredEntry[] = [
				{
					type: "user",
					id: "1",
					message: {},
					timestamp: "2024-01-01T00:00:00Z",
				},
				{
					type: "user",
					id: "2",
					message: {},
					timestamp: "2024-01-01T00:01:00Z",
				},
				{
					type: "user",
					id: "3",
					message: {},
					timestamp: "2024-01-01T00:02:00Z",
				},
			];

			const result = convertRustEntriesToStoredEntries(rustEntries);

			expect(result.map((e) => e.id)).toEqual(["1", "2", "3"]);
		});

		it("should handle large arrays efficiently", () => {
			const rustEntries: RustStoredEntry[] = Array.from({ length: 1000 }, (_, i) => ({
				type: "tool_call" as const,
				id: `tool-${i}`,
				toolCall: {
					id: `toolu_${i}`,
					name: "Edit",
					status: "completed",
					kind: "edit",
					input: { file_path: `/file-${i}.ts` },
				},
				timestamp: new Date(Date.now() + i * 1000).toISOString(),
			}));

			const start = performance.now();
			const result = convertRustEntriesToStoredEntries(rustEntries);
			const duration = performance.now() - start;

			expect(result).toHaveLength(1000);
			expect(duration).toBeLessThan(100); // Should complete in under 100ms

			// Verify all have arguments
			for (const entry of result) {
				const toolCall = entry.message as Record<string, unknown>;
				expect(toolCall.arguments).toBeDefined();
				expect(toolCall.input).toBeUndefined();
			}
		});
	});

	describe("type safety", () => {
		it("should return StoredEntry type", () => {
			const rustEntry: RustStoredEntry = {
				type: "user",
				id: "user-123",
				message: { id: "msg-123" },
				timestamp: "2024-01-01T00:00:00Z",
			};

			const result: StoredEntry = convertRustEntryToStoredEntry(rustEntry);

			// TypeScript compilation is the test - these properties must exist
			expect(result.id).toBeDefined();
			expect(result.type).toBeDefined();
			expect(result.message).toBeDefined();
			expect(result.timestamp).toBeDefined();
		});
	});

	describe("edge cases", () => {
		it("should handle tool_call with complex nested input", () => {
			const rustEntry: RustStoredEntry = {
				type: "tool_call",
				id: "tool-complex",
				toolCall: {
					id: "toolu_complex",
					name: "ComplexTool",
					status: "completed",
					kind: "other",
					input: {
						nested: {
							deeply: {
								value: [1, 2, 3],
							},
						},
						array: ["a", "b", "c"],
						nullValue: null,
						undefinedValue: undefined,
					},
				},
				timestamp: "2024-01-01T00:00:00Z",
			};

			const result = convertRustEntryToStoredEntry(rustEntry);
			const toolCall = result.message as Record<string, unknown>;

			expect(toolCall.arguments).toEqual({
				nested: { deeply: { value: [1, 2, 3] } },
				array: ["a", "b", "c"],
				nullValue: null,
				undefinedValue: undefined,
			});
		});

		it("should handle tool_call with empty object input", () => {
			const rustEntry: RustStoredEntry = {
				type: "tool_call",
				id: "tool-empty",
				toolCall: {
					id: "toolu_empty",
					name: "EmptyTool",
					status: "completed",
					kind: "other",
					input: {},
				},
				timestamp: "2024-01-01T00:00:00Z",
			};

			const result = convertRustEntryToStoredEntry(rustEntry);
			const toolCall = result.message as Record<string, unknown>;

			expect(toolCall.arguments).toEqual({});
		});
	});

	describe("convertLiveEntryToStoredEntry", () => {
		it("should convert user entry", () => {
			const entry: LiveProcessedEntry = {
				id: "user-123",
				type: "user",
				message: { id: "msg-123", content: { type: "text", text: "Hello" } },
			};

			const result = convertLiveEntryToStoredEntry(entry);

			expect(result.id).toBe("user-123");
			expect(result.type).toBe("user");
			expect(result.message).toEqual(entry.message);
			expect(result.timestamp).toBeInstanceOf(Date);
		});

		it("should convert assistant entry", () => {
			const entry: LiveProcessedEntry = {
				id: "assistant-123",
				type: "assistant",
				message: { chunks: [], model: "claude-3-opus" },
			};

			const result = convertLiveEntryToStoredEntry(entry);

			expect(result.id).toBe("assistant-123");
			expect(result.type).toBe("assistant");
			expect(result.message).toEqual(entry.message);
		});

		it("should convert ask entry", () => {
			const entry: LiveProcessedEntry = {
				id: "ask-123",
				type: "ask",
				message: { id: "ask-123", question: "Should I proceed?" },
			};

			const result = convertLiveEntryToStoredEntry(entry);

			expect(result.id).toBe("ask-123");
			expect(result.type).toBe("ask");
			expect(result.message).toEqual(entry.message);
		});

		it("should convert tool_call entry - toolCall already has arguments (not input)", () => {
			const entry: LiveProcessedEntry = {
				id: "tool-123",
				type: "tool_call",
				toolCall: {
					id: "toolu_123",
					name: "Edit",
					status: "completed",
					arguments: {
						file_path: "/test.ts",
						old_string: "a",
						new_string: "b",
					},
				},
			};

			const result = convertLiveEntryToStoredEntry(entry);

			expect(result.id).toBe("tool-123");
			expect(result.type).toBe("tool_call");
			// Message should be the toolCall directly (already has arguments)
			const toolCall = result.message as Record<string, unknown>;
			expect(toolCall.arguments).toEqual({
				file_path: "/test.ts",
				old_string: "a",
				new_string: "b",
			});
			expect(toolCall.name).toBe("Edit");
		});

		// CHARACTERIZATION: remove when projected union is authoritative — live entries are passed through unchanged (no kind repair).
		it("CHARACTERIZATION: live tool_call passes through kind including sql (remove when projected union is authoritative)", () => {
			const entry: LiveProcessedEntry = {
				id: "live-sql",
				type: "tool_call",
				toolCall: {
					id: "toolu_live",
					name: "sql",
					status: "pending",
					kind: "sql",
					arguments: { kind: "sql", query: "SELECT 1" },
				},
			};

			const result = convertLiveEntryToStoredEntry(entry);
			const toolCall = result.message as Record<string, unknown>;

			expect(toolCall.kind).toBe("sql");
		});

		it("should set current timestamp for all entry types", () => {
			const before = new Date();

			const entries: LiveProcessedEntry[] = [
				{ id: "1", type: "user", message: {} },
				{ id: "2", type: "assistant", message: {} },
				{ id: "3", type: "ask", message: {} },
				{ id: "4", type: "tool_call", toolCall: {} },
			];

			for (const entry of entries) {
				const result = convertLiveEntryToStoredEntry(entry);
				const after = new Date();

				expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
				expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
			}
		});
	});
});
